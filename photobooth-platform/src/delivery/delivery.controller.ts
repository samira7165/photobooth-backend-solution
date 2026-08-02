import { Controller, Get, Param, Res } from '@nestjs/common';
import { DeliveryService } from './delivery.service';
import { Public } from '../common/decorators/public.decorator';
import { Response } from 'express';
import * as path from 'path';

@Controller('dl')
export class DeliveryController {
  constructor(private deliveryService: DeliveryService) {}

  // Public download endpoint — no auth needed
  // This is what the QR code points to

  @Public()
  @Get(':code')
  async download(@Param('code') code: string) {
    return this.deliveryService.getDownloadInfo(code);
  }

  // Direct image download
  @Public()
  @Get(':code/image')
  async downloadImage(@Param('code') code: string, @Res() res: Response) {
    const info = await this.deliveryService.getDownloadInfo(code);

    if (info.imageUrl.startsWith('http')) {
      // Redirect to presigned S3 URL
      return res.redirect(info.imageUrl);
    } else {
      // Serve local file
      const filePath = path.join(process.cwd(), info.imageUrl);
      return res.sendFile(filePath);
    }
  }
}
