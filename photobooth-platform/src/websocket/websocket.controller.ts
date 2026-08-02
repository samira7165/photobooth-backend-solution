import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { WebsocketGateway } from './websocket.gateway';

@Controller('ws-test')
export class WebsocketController {
  constructor(private wsGateway: WebsocketGateway) {}

  @Public()
  @Get('ping')
  async ping() {
    // Emit a test event to all admin clients
    this.wsGateway.notifyQueueStats({
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
    });

    return {
      message: 'WebSocket ping sent to admin room',
      clients: this.wsGateway.getConnectedClients(),
    };
  }
}
