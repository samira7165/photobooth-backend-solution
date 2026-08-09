import { Injectable, Logger } from '@nestjs/common';
import { AiGenerateInput, AiProvider, AiProviderResult } from './ai-provider.interface';

const DEFAULT_MODEL = 'gemini-2.5-flash-image';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

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

    // Images first, prompt last — Gemini's own docs recommend grounding the
    // request in the visual content before the instruction text that acts on
    // it, rather than describing the task before the model has seen anything.
    const requestParts: any[] = [
      { inlineData: { mimeType: 'image/jpeg', data: input.imageBuffer.toString('base64') } },
    ];
    // A second image (the campaign Template's reference photo) gives Gemini
    // an actual visual style to match — costume, pose, color scheme — rather
    // than relying entirely on how well the prompt describes it in words.
    if (input.referenceImageBuffer) {
      requestParts.push({ inlineData: { mimeType: 'image/jpeg', data: input.referenceImageBuffer.toString('base64') } });
      this.logger.log(`Sending reference image to Gemini alongside the booth photo (${input.referenceImageBuffer.length} bytes)`);
    } else {
      this.logger.log('No reference image for this submission — sending only the booth photo');
    }
    requestParts.push({ text: input.prompt });

    const res = await fetch(`${API_BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': input.apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: requestParts }],
      }),
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
