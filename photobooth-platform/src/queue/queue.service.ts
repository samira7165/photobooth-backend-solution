import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

export const PHOTO_PROCESSING_QUEUE = 'photo-processing';

@Injectable()
export class QueueMonitorService {
  constructor(
    @InjectQueue(PHOTO_PROCESSING_QUEUE) private queue: Queue,
    private prisma: PrismaService,
  ) {}

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

  async getQueueStats(): Promise<{ waiting: number; active: number; completed: number; failed: number; isPaused: boolean }> {
    const [counts, isPaused] = await Promise.all([
      this.queue.getJobCounts('waiting', 'active', 'completed', 'failed'),
      this.queue.isPaused(),
    ]);
    return {
      waiting: counts.waiting || 0,
      active: counts.active || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
      isPaused,
    };
  }

  // ─── JOB LISTS (queue monitor UI) ───
  // BullMQ jobs only carry { submissionId } in job.data — campaign/mode come
  // from the Submission row, batch-fetched once per list rather than N+1.

  private async enrichJobs(jobs: Array<{ id?: string; data: { submissionId: string }; timestamp: number; progress: unknown; processedOn?: number; failedReason?: string; attemptsMade?: number }>) {
    const submissionIds = jobs.map((j) => j.data.submissionId);
    const submissions = await this.prisma.submission.findMany({
      where: { id: { in: submissionIds } },
      select: { id: true, mode: true, userName: true, campaign: { select: { name: true, slug: true } } },
    });
    const byId = new Map(submissions.map((s) => [s.id, s]));

    return jobs.map((job) => {
      const sub = byId.get(job.data.submissionId);
      return {
        jobId: job.id,
        submissionId: job.data.submissionId,
        campaignName: sub?.campaign?.name || null,
        campaignSlug: sub?.campaign?.slug || null,
        mode: sub?.mode || null,
        userName: sub?.userName || null,
        progress: typeof job.progress === 'number' ? job.progress : 0,
        queuedAt: new Date(job.timestamp).toISOString(),
        startedAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
        failedReason: job.failedReason,
        attemptsMade: job.attemptsMade,
      };
    });
  }

  async getActiveJobs() {
    const jobs = await this.queue.getActive();
    return this.enrichJobs(jobs);
  }

  async getWaitingJobs() {
    const jobs = await this.queue.getWaiting();
    return this.enrichJobs(jobs);
  }

  async getFailedJobs() {
    const jobs = await this.queue.getFailed();
    return this.enrichJobs(jobs);
  }

  // ─── QUEUE CONTROLS ───

  async pauseQueue() {
    await this.queue.pause();
    return { message: 'Queue paused' };
  }

  async resumeQueue() {
    await this.queue.resume();
    return { message: 'Queue resumed' };
  }

  // Drains waiting jobs only — active jobs finish normally, matching
  // BullMQ's own drain() semantics (it never touches in-flight jobs).
  async drainQueue() {
    await this.queue.drain();
    return { message: 'Queue drained' };
  }

  async retryJob(jobId: string) {
    const job = await this.queue.getJob(jobId);
    if (!job) throw new NotFoundException('Job not found');
    await job.retry();
    return { message: 'Job queued for retry' };
  }

  async removeJob(jobId: string) {
    const job = await this.queue.getJob(jobId);
    if (!job) throw new NotFoundException('Job not found');
    await job.remove();
    return { message: 'Job removed' };
  }
}
