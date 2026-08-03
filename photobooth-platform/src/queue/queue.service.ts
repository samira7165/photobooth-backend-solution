import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export const PHOTO_PROCESSING_QUEUE = 'photo-processing';

@Injectable()
export class QueueMonitorService {
  constructor(@InjectQueue(PHOTO_PROCESSING_QUEUE) private queue: Queue) {}

  // No custom jobId: with removeOnFail keeping recent failures around (for
  // getQueueStats()'s failed count), reusing submissionId as the jobId meant
  // retrySubmission()'s addJob() call silently no-op'd against the old,
  // already-exhausted job instead of creating a new attempt cycle — BullMQ's
  // add() doesn't reset/reprocess an existing job by id, terminal state or
  // not. Letting BullMQ generate a fresh id per call avoids that; submissionId
  // still travels in job.data for correlation everywhere else.
  async addJob(submissionId: string) {
    await this.queue.add(
      'process-submission',
      { submissionId },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 },
      },
    );
  }

  async getQueueStats(): Promise<{ waiting: number; active: number; completed: number; failed: number }> {
    const counts = await this.queue.getJobCounts('waiting', 'active', 'completed', 'failed');
    return {
      waiting: counts.waiting || 0,
      active: counts.active || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
    };
  }
}
