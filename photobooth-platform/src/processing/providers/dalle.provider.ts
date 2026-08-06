import { Injectable, Logger } from '@nestjs/common';
import { AiGenerateInput, AiProvider, AiProviderResult } from './ai-provider.interface';

const DEFAULT_MODEL = 'gpt-image-1';
const API_URL = 'https://api.openai.com/v1/images/edits';

// Calls OpenAI's image-edit endpoint with the booth photo as the base image
// to edit and the campaign's prompt describing the transformation. Uses
// images/edits (not images/generations) because the booth photo itself is
// the input being transformed, not just prompt text.
@Injectable()
export class DalleProvider implements AiProvider {
  name = 'dalle';
  private logger = new Logger(DalleProvider.name);

  async generate(input: AiGenerateInput): Promise<AiProviderResult> {
    const model = input.model || DEFAULT_MODEL;
    const startedAt = Date.now();

    const form = new FormData();
    form.append('model', model);
    form.append('prompt', input.prompt);
    // Booth originals are captured as JPEG; gpt-image-1 accepts png/jpeg/webp
    // input for edits.
    form.append('image', new Blob([new Uint8Array(input.imageBuffer)], { type: 'image/jpeg' }), 'input.jpg');

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => res.statusText);
      throw new Error(`OpenAI image API error (${res.status}): ${errBody}`);
    }

    const data: any = await res.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) {
      throw new Error('OpenAI response contained no image data');
    }

    return {
      imageBuffer: Buffer.from(b64, 'base64'),
      mimeType: 'image/png',
      model,
      processingTimeMs: Date.now() - startedAt,
      tokensUsed: data?.usage?.total_tokens,
    };
  }
}
