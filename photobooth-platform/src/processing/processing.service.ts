import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiProvidersService } from '../ai-providers/ai-providers.service';
import { ProviderFactory } from './providers/provider.factory';
import { decrypt } from '../common/utils/encryption';

export interface AiGenerationConfig {
  prompt?: string;
  model?: string;
  fallbackProviders?: string[];
  keyChain?: string[]; // ordered ApiKeyModel ids
}

export interface AiGenerationResult {
  resultBuffer: Buffer;
  resultMimeType: string;
  provider: string;
  model: string;
  keyId: string;
  tokensUsed?: number;
  costEstimate?: number;
}

const DEFAULT_PROMPT = 'Enhance this photo';

// Owns the "call an AI provider to transform this photo, trying keys in
// order until one works" step of the pipeline. Two selection strategies:
//
// - aiConfig.keyChain present: try each specific ApiKey id in exact order
//   (a campaign's configured primary + fallbacks, which may repeat a
//   provider with a different model).
// - keyChain absent: fall back to AiProvidersService.getKeyWithFailover(),
//   the original provider-name-priority selection, for campaigns configured
//   before per-key chains existed.
@Injectable()
export class ProcessingService {
  private logger = new Logger(ProcessingService.name);

  constructor(
    private prisma: PrismaService,
    private aiProvidersService: AiProvidersService,
    private providerFactory: ProviderFactory,
  ) {}

  async generate(campaignId: string, imageBuffer: Buffer, aiConfig: AiGenerationConfig): Promise<AiGenerationResult> {
    const prompt = aiConfig?.prompt || DEFAULT_PROMPT;
    const keyChain = aiConfig?.keyChain || [];

    if (keyChain.length > 0) {
      return this.generateWithKeyChain(keyChain, imageBuffer, prompt, aiConfig?.model);
    }
    return this.generateWithProviderPriority(campaignId, imageBuffer, prompt, aiConfig);
  }

  // keyChain entries are ApiKeyModel ids, not ApiKey ids — one physical key
  // can appear multiple times in a chain under different models, so the
  // chain has to identify (key, model) pairs, not just keys.
  private async generateWithKeyChain(
    keyChain: string[],
    imageBuffer: Buffer,
    prompt: string,
    fallbackModel?: string,
  ): Promise<AiGenerationResult> {
    const errors: string[] = [];

    for (const chainEntryId of keyChain) {
      const apiKeyModel = await this.prisma.apiKeyModel.findUnique({
        where: { id: chainEntryId },
        include: { apiKey: { include: { provider: true } } },
      });

      if (!apiKeyModel) {
        this.logger.warn(`Chain entry ${chainEntryId} not found, skipping`);
        errors.push(`${chainEntryId}: not found`);
        continue;
      }

      const keyRecord = apiKeyModel.apiKey;
      const model = apiKeyModel.model || fallbackModel;
      const label = `${keyRecord.provider.name} / ${model}`;

      if (!keyRecord.isActive) {
        this.logger.warn(`Key ${keyRecord.id} (${label}) is inactive, skipping`);
        continue;
      }
      if (!keyRecord.provider.isHealthy) {
        this.logger.warn(`Key ${keyRecord.id} (${label}) provider is unhealthy, skipping`);
        continue;
      }
      if (keyRecord.dailyLimit && keyRecord.usageToday >= keyRecord.dailyLimit) {
        this.logger.warn(`Key ${keyRecord.id} (${label}) hit daily limit, skipping`);
        continue;
      }

      const provider = this.providerFactory.get(keyRecord.provider.name);
      if (!provider) {
        this.logger.warn(`No provider implementation for "${keyRecord.provider.name}", skipping key ${keyRecord.id}`);
        errors.push(`${label}: no provider implementation`);
        continue;
      }

      const startedAt = Date.now();
      try {
        this.logger.log(`Trying key ${keyRecord.id} (${label})...`);
        const result = await provider.generate({
          imageBuffer,
          prompt,
          apiKey: decrypt(keyRecord.encryptedKey),
          model,
        });
        const responseTime = Date.now() - startedAt;
        await this.aiProvidersService.recordKeyUsage(keyRecord.id, true, responseTime);

        return {
          resultBuffer: result.imageBuffer,
          resultMimeType: result.mimeType,
          provider: keyRecord.provider.name,
          model: result.model,
          keyId: keyRecord.id,
          tokensUsed: result.tokensUsed,
          costEstimate: result.costEstimate,
        };
      } catch (err: any) {
        const responseTime = Date.now() - startedAt;
        this.logger.error(`Key ${keyRecord.id} (${label}) failed: ${err.message}`);
        errors.push(`${label}(${keyRecord.id}): ${err.message}`);
        await this.aiProvidersService.recordKeyUsage(keyRecord.id, false, responseTime, err.message);
      }
    }

    throw new Error(`All AI providers in the key chain failed. Errors: ${errors.join(' | ') || 'no keys configured'}`);
  }

  // Original behavior, kept for campaigns whose aiConfig predates keyChain:
  // pick one key via provider-priority, try it once.
  private async generateWithProviderPriority(
    campaignId: string,
    imageBuffer: Buffer,
    prompt: string,
    aiConfig?: AiGenerationConfig,
  ): Promise<AiGenerationResult> {
    const selected = await this.aiProvidersService.getKeyWithFailover(campaignId, aiConfig?.fallbackProviders);

    const provider = this.providerFactory.get(selected.providerName);
    if (!provider) {
      throw new Error(`No provider implementation for "${selected.providerName}"`);
    }

    const startedAt = Date.now();
    try {
      this.logger.log(`Trying provider ${selected.providerName} (key ${selected.keyId})...`);
      const result = await provider.generate({
        imageBuffer,
        prompt,
        apiKey: selected.key,
        model: aiConfig?.model,
      });
      const responseTime = Date.now() - startedAt;
      await this.aiProvidersService.recordKeyUsage(selected.keyId, true, responseTime);

      return {
        resultBuffer: result.imageBuffer,
        resultMimeType: result.mimeType,
        provider: selected.providerName,
        model: result.model,
        keyId: selected.keyId,
        tokensUsed: result.tokensUsed,
        costEstimate: result.costEstimate,
      };
    } catch (err: any) {
      const responseTime = Date.now() - startedAt;
      this.logger.error(`Provider ${selected.providerName} failed: ${err.message}`);
      await this.aiProvidersService.recordKeyUsage(selected.keyId, false, responseTime, err.message);
      throw new Error(`AI provider failed. provider=${selected.providerName} key=${selected.keyId}: ${err.message}`, { cause: err });
    }
  }
}
