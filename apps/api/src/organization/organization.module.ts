import { Module } from '@nestjs/common';

import { DepartmentsController } from './departments.controller';
import { GroupsController } from './groups.controller';
import { OrganizationService } from './organization.service';

@Module({
  controllers: [DepartmentsController, GroupsController],
  providers: [OrganizationService],
})
export class OrganizationModule {}
