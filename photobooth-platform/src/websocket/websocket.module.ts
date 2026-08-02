import { Module, Global } from '@nestjs/common';
import { WebsocketGateway } from './websocket.gateway';
import { WebsocketController } from './websocket.controller';

@Global()
@Module({
  controllers: [WebsocketController],
  providers: [WebsocketGateway],
  exports: [WebsocketGateway],
})
export class WebsocketModule {}
