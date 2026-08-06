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

    const res = await fetch(`${API_BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': input.apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: input.prompt },
              { inlineData: { mimeType: 'image/jpeg', data: input.imageBuffer.toString('base64') } },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => res.statusText);
      throw new Error(`Gemini API error (${res.status}): ${errBody}`);
    }

    const data: any = await res.json();
    const parts: any[] = data?.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p) => p?.inlineData?.data);

    if (!imagePart) {
      const textPart = parts.find((p) => p?.text)?.text;
      throw new Error(`Gemini returned no image data${textPart ? `: ${textPart}` : ''}`);
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
