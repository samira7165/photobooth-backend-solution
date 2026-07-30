import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Role } from '@prisma/client';

// Every route here needs a valid JWT (enforced globally by JwtAuthGuard) plus
// the role listed on each handler (enforced by RolesGuard, which honors the
// SUPER_ADMIN > ADMIN > OPERATOR > VIEWER hierarchy — e.g. @Roles('ADMIN')
// also lets SUPER_ADMIN through).
@Controller('users')
@UseGuards(RolesGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  // Only SUPER_ADMIN can create staff accounts or change someone's role —
  // ADMIN can view/manage day-to-day but not grant privileges.
  @Post()
  @Roles('SUPER_ADMIN')
  async create(@Body() body: { email: string; password: string; name: string; role?: Role }) {
    return this.usersService.create(body);
  }

  @Get()
  @Roles('SUPER_ADMIN', 'ADMIN')
  async findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'ADMIN')
  async findById(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN')
  async update(
    @Param('id') id: string,
    @Body() body: { name?: string; role?: Role; isActive?: boolean },
  ) {
    return this.usersService.update(id, body);
  }

  @Patch(':id/password')
  @Roles('SUPER_ADMIN')
  async changePassword(@Param('id') id: string, @Body() body: { password: string }) {
    return this.usersService.changePassword(id, body.password);
  }

  @Delete(':id')
  @Roles('SUPER_ADMIN')
  async delete(@Param('id') id: string) {
    return this.usersService.delete(id);
  }
}
