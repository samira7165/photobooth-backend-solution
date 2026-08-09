import { Controller, Get, Post, Delete, Param, UseGuards } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { QueueMonitorService } from './queue.service';

@Controller('admin/queue')
@UseGuards(RolesGuard)
@Roles('ADMIN')
export class QueueController {
  constructor(
    private wsGateway: WebsocketGateway,
    private queueService: QueueMonitorService,
  ) {}

  @Get('clients')
  async getConnectedClients() {
    return this.wsGateway.getConnectedClients();
  }

  @Get('stats')
  async getStats() {
    return this.queueService.getQueueStats();
  }

  @Get('active')
  async getActive() {
    return this.queueService.getActiveJobs();
  }

  @Get('waiting')
  async getWaiting() {
    return this.queueService.getWaitingJobs();
  }

  @Get('failed')
  async getFailed() {
    return this.queueService.getFailedJobs();
  }

  @Get('completed')
  async getCompleted() {
    return this.queueService.getCompletedJobs();
  }

  @Post('pause')
  async pause() {
    return this.queueService.pauseQueue();
  }

  @Post('resume')
  async resume() {
    return this.queueService.resumeQueue();
  }

  @Post('drain')
  async drain() {
    return this.queueService.drainQueue();
  }

  @Post('retry/:jobId')
  async retry(@Param('jobId') jobId: string) {
    return this.queueService.retryJob(jobId);
  }

  @Delete(':jobId')
  async remove(@Param('jobId') jobId: string) {
    return this.queueService.removeJob(jobId);
  }
}
