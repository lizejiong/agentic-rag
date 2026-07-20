import { Module } from '@nestjs/common';

import { SpacePolicy } from './space-policy';
import { SpacesController } from './spaces.controller';
import { SpacesService } from './spaces.service';

@Module({
  controllers: [SpacesController],
  providers: [SpacesService, SpacePolicy],
  exports: [SpacePolicy],
})
export class SpacesModule {}
