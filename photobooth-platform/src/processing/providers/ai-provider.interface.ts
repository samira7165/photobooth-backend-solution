// A single provider call always uses one specific decrypted key + model —
// callers (ProcessingService) resolve which key/model to use per attempt in
// the failover loop, so neither is baked into the provider instance itself.
export interface AiGenerateInput {
  imageBuffer: Buffer;
  prompt: string;
  apiKey: string;
  model?: string;
  // A Template's style-reference image (e.g. a "Spider-Man suit" reference
  // photo), sent alongside imageBuffer so the provider can match its visual
  // style rather than just following a text description of it. Support is
  // provider-dependent — see each provider's generate() for how (or
  // whether) it actually uses this.
  referenceImageBuffer?: Buffer;
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
