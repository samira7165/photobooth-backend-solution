import { Injectable, Logger } from '@nestjs/common';
import { AiGenerateInput, AiProvider, AiProviderResult } from './ai-provider.interface';

const DEFAULT_MODEL = 'gemini-2.5-flash-image';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Every aspect ratio gemini-2.5-flash-image's imageConfig.aspectRatio
// actually accepts, as [ratio string, numeric width/height value] pairs —
// see https://developers.googleblog.com/en/gemini-2-5-flash-image-now-ready-for-production-with-new-aspect-ratios/
const SUPPORTED_ASPECT_RATIOS: [string, number][] = [
  ['21:9', 21 / 9],
  ['16:9', 16 / 9],
  ['4:3', 4 / 3],
  ['3:2', 3 / 2],
  ['5:4', 5 / 4],
  ['1:1', 1],
  ['4:5', 4 / 5],
  ['2:3', 2 / 3],
  ['3:4', 3 / 4],
  ['9:16', 9 / 16],
];

// Asking Gemini for a specific output size via prompt text alone is
// unreliable (confirmed: it was routinely ignored, producing images in
// whatever ratio the model felt like, which then either got cropped or
// letterboxed by ImageService.resize downstream). This maps the campaign's
// actual target dimensions to the closest of Gemini's real supported
// aspect ratios instead, so the request states it as an actual generation
// parameter rather than a sentence the model can skip.
function closestAspectRatio(width: number, height: number): string {
  const target = width / height;
  let best = SUPPORTED_ASPECT_RATIOS[0];
  let bestDiff = Infinity;
  for (const candidate of SUPPORTED_ASPECT_RATIOS) {
    const diff = Math.abs(candidate[1] - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = candidate;
    }
  }
  return best[0];
}

// Calls Gemini's image-generation endpoint (aka "nano banana") with the
// booth photo as inlineData plus the campaign's text prompt, and expects an
// image part back in the response. Uses the model baked into the selected
// ApiKey record (keyRecord.model), falling back to DEFAULT_MODEL.
@Injectable()
export class GeminiProvider implements AiProvider {
  name = 'gemini';
  private logger = new Logger(GeminiProvider.name);

  async generate(input: AiGenerateInput): Promise<AiProviderResult> {
    const model = input.model || DEFAULT_MODEL;
    const startedAt = Date.now();

    // Reference/style image first, then the user's own booth photo, then
    // the prompt last — the reference establishes the target style before
    // Gemini sees the photo it needs to apply that style to, and the prompt
    // (as text instruction) comes only after both images are in context.
    const requestParts: any[] = [];
    if (input.referenceImageBuffer) {
      requestParts.push({ inlineData: { mimeType: 'image/jpeg', data: input.referenceImageBuffer.toString('base64') } });
      this.logger.log(`Sending reference image to Gemini ahead of the booth photo (${input.referenceImageBuffer.length} bytes)`);
    } else {
      this.logger.log('No reference image for this submission — sending only the booth photo');
    }
    requestParts.push({ inlineData: { mimeType: 'image/jpeg', data: input.imageBuffer.toString('base64') } });
    requestParts.push({ text: input.prompt });

    const body: any = { contents: [{ parts: requestParts }] };
    if (input.outputWidth && input.outputHeight) {
      const aspectRatio = closestAspectRatio(input.outputWidth, input.outputHeight);
      body.generationConfig = { imageConfig: { aspectRatio } };
      this.logger.log(`Requesting Gemini aspectRatio ${aspectRatio} for target ${input.outputWidth}x${input.outputHeight}`);
    }

    const res = await fetch(`${API_BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': input.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => res.statusText);
      throw new Error(`Gemini API error (${res.status}): ${errBody}`);
    }

    const data: any = await res.json();
    const candidate = data?.candidates?.[0];
    const parts: any[] = candidate?.content?.parts || [];
    const imagePart = parts.find((p) => p?.inlineData?.data);

    if (!imagePart) {
      const textPart = parts.find((p) => p?.text)?.text;
      // A finishReason other than STOP (e.g. SAFETY, PROHIBITED_CONTENT) means
      // Gemini's own content policy blocked the request before generating
      // anything — content.parts is entirely absent in that case, not just
      // missing an image, so this is the only diagnostic available.
      const blockReason = candidate?.finishReason && candidate.finishReason !== 'STOP' ? candidate.finishReason : null;
      const detail = textPart || (blockReason ? `blocked by Gemini's content policy (${blockReason})` : null);
      throw new Error(`Gemini returned no image data${detail ? `: ${detail}` : ''}`);
    }

    return {
      imageBuffer: Buffer.from(imagePart.inlineData.data, 'base64'),
      mimeType: imagePart.inlineData.mimeType || 'image/png',
      model,
      processingTimeMs: Date.now() - startedAt,
      tokensUsed: data?.usageMetadata?.totalTokenCount,
    };
  }
}
