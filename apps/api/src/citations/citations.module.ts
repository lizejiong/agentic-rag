import { Module } from '@nestjs/common';
import { CitationsController } from './citations.controller';

@Module({
  controllers: [CitationsController],
})
export class CitationsModule {}
