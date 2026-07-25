import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    let db = 'down';
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      db = 'up';
    } catch {
      db = 'down';
    }
    return {
      status: db === 'up' ? 'ok' : 'degraded',
      service: 'openbooks-api',
      db,
      time: new Date().toISOString(),
    };
  }
}
