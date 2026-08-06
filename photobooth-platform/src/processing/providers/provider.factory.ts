import { Injectable } from '@nestjs/common';
import { AiProvider } from './ai-provider.interface';
import { GeminiProvider } from './gemini.provider';
import { DalleProvider } from './dalle.provider';
import { ReplicateProvider } from './replicate.provider';

// Maps an AiProvider row's `name` (as stored in the database, e.g. "gemini")
// to the concrete provider implementation that knows how to call it.
@Injectable()
export class ProviderFactory {
  private readonly providers: Map<string, AiProvider>;

  constructor(gemini: GeminiProvider, dalle: DalleProvider, replicate: ReplicateProvider) {
    this.providers = new Map<string, AiProvider>([
      [gemini.name, gemini],
      [dalle.name, dalle],
      [replicate.name, replicate],
    ]);
  }

  get(providerName: string): AiProvider | undefined {
    return this.providers.get(providerName);
  }
}
