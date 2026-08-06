// A single provider call always uses one specific decrypted key + model —
// callers (ProcessingService) resolve which key/model to use per attempt in
// the failover loop, so neither is baked into the provider instance itself.
export interface AiGenerateInput {
  imageBuffer: Buffer;
  prompt: string;
  apiKey: string;
  model?: string;
}

export interface AiProviderResult {
  imageBuffer: Buffer;
  mimeType: string;
  model: string;
  processingTimeMs: number;
  tokensUsed?: number;
  costEstimate?: number;
}

export interface AiProvider {
  name: string;
  generate(input: AiGenerateInput): Promise<AiProviderResult>;
}
