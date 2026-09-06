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
import { PromptOptionsService } from './prompt-options.service';
import { CreatePromptOptionDto } from './dto/create-prompt-option.dto';
import { UpdatePromptOptionDto } from './dto/update-prompt-option.dto';
import { ReorderPromptOptionsDto } from './dto/reorder-prompt-options.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

// Booth-selectable text prompts for campaigns with no reference-image
// Template (aiConfig.promptMode "prompt-option"/"both" — see the PromptOption
// model comment in schema.prisma). Staff-only, same as /assets.
@Controller('prompt-options')
@UseGuards(RolesGuard)
@Roles('ADMIN')
export class PromptOptionsController {
  constructor(private promptOptionsService: PromptOptionsService) {}

  // multipart/form-data: text fields (name, campaignId, prompt, ...) plus an
  // OPTIONAL file under the "thumbnail" field name — unlike assets' image
  // uploads, a PromptOption has no reference image to require.
  @Post()
  @UseInterceptors(FileInterceptor('thumbnail'))
  async create(@Body() dto: CreatePromptOptionDto, @UploadedFile() file: Express.Multer.File, @Request() req) {
    return this.promptOptionsService.create(dto, file, req.user.id);
  }

  @Get()
  async findAll(@Query('campaignId') campaignId: string, @Query('includeInactive') includeInactive?: string) {
    if (!campaignId) throw new BadRequestException('campaignId query parameter is required');
    return this.promptOptionsService.findAllByCampaign(campaignId, includeInactive === 'true');
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.promptOptionsService.findById(id);
  }

  @Patch(':id')
  @UseInterceptors(FileInterceptor('thumbnail'))
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePromptOptionDto,
    @UploadedFile() file: Express.Multer.File,
    @Request() req,
  ) {
    return this.promptOptionsService.update(id, dto, file, req.user.id);
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @Request() req) {
    return this.promptOptionsService.delete(id, req.user.id);
  }

  @Post('reorder')
  async reorder(@Body() dto: ReorderPromptOptionsDto, @Request() req) {
    return this.promptOptionsService.reorder(dto.ids, req.user.id);
  }
}
