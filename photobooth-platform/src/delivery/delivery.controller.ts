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
    // Info-only fetch (the guest-facing page renders a preview + a separate
    // Download button) — shouldn't count as an actual download by itself.
    return this.deliveryService.getDownloadInfo(code, { countAsDownload: false });
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
      // Serve local file. The download page (admin-dashboard, :3002) and
      // this API (:3000) are different origins, and browsers ignore the
      // HTML `download` attribute on cross-origin links — without this
      // header, clicking "Download" just navigates to view the image
      // instead of saving it. Setting Content-Disposition here forces a
      // real download regardless of which origin linked to it.
      const filePath = path.join(process.cwd(), info.imageUrl);
      const ext = path.extname(filePath) || '.png';
      return res.sendFile(filePath, {
        headers: { 'Content-Disposition': `attachment; filename="photobooth${ext}"` },
      });
    }
  }
}
