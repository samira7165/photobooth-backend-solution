import { Injectable } from '@nestjs/common';
import { AiGenerateInput, AiProvider, AiProviderResult } from './ai-provider.interface';

// Not implemented — no Replicate model/version was specified for this
// pipeline. Kept as a properly-typed provider (rather than a bare stub) so
// it still fails cleanly through the normal failover error-handling path
// instead of a class-shape TypeError.
@Injectable()
export class ReplicateProvider implements AiProvider {
  name = 'replicate';

  async generate(_input: AiGenerateInput): Promise<AiProviderResult> {
    throw new Error('Replicate provider is not yet implemented');
  }
}
