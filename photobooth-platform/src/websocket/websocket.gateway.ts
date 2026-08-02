import { WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, MessageBody, ConnectedSocket } from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: [
      'http://localhost:3001',
      'http://localhost:3002',
      process.env.FRONTEND_URL,
      process.env.ADMIN_URL,
    ].filter(Boolean),
    credentials: true,
  },
  namespace: '/ws',
})
export class WebsocketGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private logger = new Logger(WebsocketGateway.name);

  // Track connected clients
  private boothClients = new Map<string, { socketId: string; campaignSlug: string; hallId?: string }>();
  private adminClients = new Set<string>();

  afterInit() {
    this.logger.log('WebSocket gateway initialized');
  }

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    this.boothClients.delete(client.id);
    this.adminClients.delete(client.id);
  }

  // ─── BOOTH JOINS A CAMPAIGN ROOM ───

  @SubscribeMessage('booth:join')
  handleBoothJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { campaignSlug: string; sessionId: string; hallId?: string },
  ) {
    const roomName = `campaign:${data.campaignSlug}`;
    client.join(roomName);

    if (data.sessionId) {
      client.join(`session:${data.sessionId}`);
    }

    this.boothClients.set(client.id, {
      socketId: client.id,
      campaignSlug: data.campaignSlug,
      hallId: data.hallId,
    });

    this.logger.log(`Booth joined room ${roomName} (hall: ${data.hallId || 'unknown'})`);

    return { status: 'joined', room: roomName };
  }

  // ─── ADMIN JOINS THE ADMIN ROOM ───

  @SubscribeMessage('admin:join')
  handleAdminJoin(@ConnectedSocket() client: Socket) {
    client.join('admin');
    this.adminClients.add(client.id);
    this.logger.log(`Admin joined admin room`);
    return { status: 'joined', room: 'admin' };
  }

  // ─── BOOTH SUBSCRIBES TO A SPECIFIC SUBMISSION ───

  @SubscribeMessage('booth:subscribe')
  handleBoothSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { submissionId: string },
  ) {
    client.join(`submission:${data.submissionId}`);
    this.logger.debug(`Client subscribed to submission:${data.submissionId}`);
    return { status: 'subscribed', submissionId: data.submissionId };
  }

  // ─── SERVER-SIDE EMIT METHODS (called by other services) ───

  // Notify booth that a job status changed
  notifyJobStatusUpdate(submissionId: string, campaignSlug: string, update: {
    status: string;
    progress?: number;
    resultUrl?: string;
    qrCodeUrl?: string;
    downloadUrl?: string;
    downloadCode?: string;
    error?: string;
    processingTime?: number;
  }) {
    // Send to the specific submission room
    this.server.to(`submission:${submissionId}`).emit('job:status', {
      submissionId,
      ...update,
      timestamp: new Date().toISOString(),
    });

    // Also send to the campaign room (so all booths in that campaign see updates)
    this.server.to(`campaign:${campaignSlug}`).emit('campaign:job_update', {
      submissionId,
      status: update.status,
      timestamp: new Date().toISOString(),
    });

    // Also send to admin room
    this.server.to('admin').emit('admin:job_update', {
      submissionId,
      campaignSlug,
      ...update,
      timestamp: new Date().toISOString(),
    });
  }

  // Notify admins about queue stats changes
  notifyQueueStats(stats: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  }) {
    this.server.to('admin').emit('admin:queue_stats', {
      ...stats,
      timestamp: new Date().toISOString(),
    });
  }

  // Notify admins about new submission
  notifyNewSubmission(submission: {
    submissionId: string;
    campaignSlug: string;
    userName?: string;
    hallId?: string;
    mode: string;
  }) {
    this.server.to('admin').emit('admin:new_submission', {
      ...submission,
      timestamp: new Date().toISOString(),
    });
  }

  // Notify about provider health changes
  notifyProviderHealth(provider: string, isHealthy: boolean, errorMessage?: string) {
    this.server.to('admin').emit('admin:provider_health', {
      provider,
      isHealthy,
      errorMessage,
      timestamp: new Date().toISOString(),
    });
  }

  // Get connected clients info (for admin monitoring)
  getConnectedClients() {
    return {
      totalConnected: this.boothClients.size + this.adminClients.size,
      booths: Array.from(this.boothClients.values()),
      admins: this.adminClients.size,
    };
  }
}
