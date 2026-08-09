import { Module } from '@nestjs/common';

import { SpacesModule } from '../spaces/spaces.module';
import { GraphController } from './graph.controller';
import { GraphService } from './graph.service';

@Module({ imports: [SpacesModule], controllers: [GraphController], providers: [GraphService] })
export class GraphModule {}
