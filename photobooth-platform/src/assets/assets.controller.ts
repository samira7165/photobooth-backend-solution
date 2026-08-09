import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AssetsService } from './assets.service';
import { CreateBackgroundDto } from './dto/create-background.dto';
import { CreateFrameDto } from './dto/create-frame.dto';
import { CreatePropDto } from './dto/create-prop.dto';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

// Every route here needs ADMIN or above — asset management (uploading
// backgrounds/frames/props) is a staff-only operation.
@Controller('assets')
@UseGuards(RolesGuard)
@Roles('ADMIN')
export class AssetsController {
  constructor(private assetsService: AssetsService) {}

  // ─── BACKGROUNDS ───

  // multipart/form-data: text fields (name, campaignId, ...) plus one file
  // under the "image" field name. FileInterceptor('image') must match that
  // field name exactly.
  @Post('backgrounds')
  @UseInterceptors(FileInterceptor('image'))
  async createBackground(
    @Body() dto: CreateBackgroundDto,
    @UploadedFile() file: Express.Multer.File,
    @Request() req,
  ) {
    if (!file) throw new BadRequestException('image file is required');
    return this.assetsService.createBackground(dto, file, req.user.id);
  }

  @Get('backgrounds/:campaignId')
  async listBackgrounds(
    @Param('campaignId') campaignId: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.assetsService.findAllBackgrounds(campaignId, includeInactive === 'true');
  }

  @Patch('backgrounds/reorder/:campaignId')
  async reorderBackgrounds(
    @Param('campaignId') campaignId: string,
    @Body() body: { orderedIds: string[] },
    @Request() req,
  ) {
    return this.assetsService.reorderBackgrounds(campaignId, body.orderedIds, req.user.id);
  }

  @Patch('backgrounds/:id/image')
  @UseInterceptors(FileInterceptor('image'))
  async replaceBackgroundImage(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Request() req,
  ) {
    if (!file) throw new BadRequestException('image file is required');
    return this.assetsService.updateBackgroundImage(id, file, req.user.id);
  }

  @Patch('backgrounds/:id')
  async updateBackground(@Param('id') id: string, @Body() dto: UpdateAssetDto, @Request() req) {
    return this.assetsService.updateBackground(id, dto, req.user.id);
  }

  @Delete('backgrounds/:id')
  async deleteBackground(@Param('id') id: string, @Request() req) {
    return this.assetsService.deleteBackground(id, req.user.id);
  }

  // ─── FRAMES ───

  @Post('frames')
  @UseInterceptors(FileInterceptor('image'))
  async createFrame(@Body() dto: CreateFrameDto, @UploadedFile() file: Express.Multer.File, @Request() req) {
    if (!file) throw new BadRequestException('image file is required');
    return this.assetsService.createFrame(dto, file, req.user.id);
  }

  @Get('frames/:campaignId')
  async listFrames(@Param('campaignId') campaignId: string, @Query('includeInactive') includeInactive?: string) {
    return this.assetsService.findAllFrames(campaignId, includeInactive === 'true');
  }

  @Patch('frames/reorder/:campaignId')
  async reorderFrames(
    @Param('campaignId') campaignId: string,
    @Body() body: { orderedIds: string[] },
    @Request() req,
  ) {
    return this.assetsService.reorderFrames(campaignId, body.orderedIds, req.user.id);
  }

  @Patch('frames/:id/image')
  @UseInterceptors(FileInterceptor('image'))
  async replaceFrameImage(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @Request() req) {
    if (!file) throw new BadRequestException('image file is required');
    return this.assetsService.updateFrameImage(id, file, req.user.id);
  }

  @Patch('frames/:id')
  async updateFrame(@Param('id') id: string, @Body() dto: UpdateAssetDto, @Request() req) {
    return this.assetsService.updateFrame(id, dto, req.user.id);
  }

  @Delete('frames/:id')
  async deleteFrame(@Param('id') id: string, @Request() req) {
    return this.assetsService.deleteFrame(id, req.user.id);
  }

  // ─── PROPS ───

  @Post('props')
  @UseInterceptors(FileInterceptor('image'))
  async createProp(@Body() dto: CreatePropDto, @UploadedFile() file: Express.Multer.File, @Request() req) {
    if (!file) throw new BadRequestException('image file is required');
    return this.assetsService.createProp(dto, file, req.user.id);
  }

  @Get('props/:campaignId')
  async listProps(@Param('campaignId') campaignId: string, @Query('includeInactive') includeInactive?: string) {
    return this.assetsService.findAllProps(campaignId, includeInactive === 'true');
  }

  @Patch('props/reorder/:campaignId')
  async reorderProps(
    @Param('campaignId') campaignId: string,
    @Body() body: { orderedIds: string[] },
    @Request() req,
  ) {
    return this.assetsService.reorderProps(campaignId, body.orderedIds, req.user.id);
  }

  @Patch('props/:id/image')
  @UseInterceptors(FileInterceptor('image'))
  async replacePropImage(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @Request() req) {
    if (!file) throw new BadRequestException('image file is required');
    return this.assetsService.updatePropImage(id, file, req.user.id);
  }

  @Patch('props/:id')
  async updateProp(@Param('id') id: string, @Body() dto: UpdateAssetDto, @Request() req) {
    return this.assetsService.updateProp(id, dto, req.user.id);
  }

  @Delete('props/:id')
  async deleteProp(@Param('id') id: string, @Request() req) {
    return this.assetsService.deleteProp(id, req.user.id);
  }

  // ─── TEMPLATES ───

  @Post('templates')
  @UseInterceptors(FileInterceptor('image'))
  async createTemplate(@Body() dto: CreateTemplateDto, @UploadedFile() file: Express.Multer.File, @Request() req) {
    if (!file) throw new BadRequestException('image file is required');
    return this.assetsService.createTemplate(dto, file, req.user.id);
  }

  @Get('templates/:campaignId')
  async listTemplates(@Param('campaignId') campaignId: string, @Query('includeInactive') includeInactive?: string) {
    return this.assetsService.findAllTemplates(campaignId, includeInactive === 'true');
  }

  @Patch('templates/reorder/:campaignId')
  async reorderTemplates(
    @Param('campaignId') campaignId: string,
    @Body() body: { orderedIds: string[] },
    @Request() req,
  ) {
    return this.assetsService.reorderTemplates(campaignId, body.orderedIds, req.user.id);
  }

  @Patch('templates/:id/image')
  @UseInterceptors(FileInterceptor('image'))
  async replaceTemplateImage(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @Request() req) {
    if (!file) throw new BadRequestException('image file is required');
    return this.assetsService.updateTemplateImage(id, file, req.user.id);
  }

  @Patch('templates/:id')
  async updateTemplate(@Param('id') id: string, @Body() dto: UpdateAssetDto, @Request() req) {
    return this.assetsService.updateTemplate(id, dto, req.user.id);
  }

  @Delete('templates/:id')
  async deleteTemplate(@Param('id') id: string, @Request() req) {
    return this.assetsService.deleteTemplate(id, req.user.id);
  }
}
