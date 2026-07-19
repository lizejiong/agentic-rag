import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get('live')
  live() {
    return { status: 'live' } as const;
  }

  @Get('ready')
  ready() {
    return { status: 'ready' } as const;
  }
}
