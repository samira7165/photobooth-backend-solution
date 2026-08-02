import { Controller, Get, UseGuards } from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { WebsocketGateway } from '../websocket/websocket.gateway';

@Controller('admin/queue')
export class QueueController {
  constructor(private wsGateway: WebsocketGateway) {}

  @Get('clients')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async getConnectedClients() {
    return this.wsGateway.getConnectedClients();
  }
}
