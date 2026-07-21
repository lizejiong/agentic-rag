import { Module } from '@nestjs/common';

import { DocumentImportController } from './document-import.controller';
import { DocumentImportService } from './document-import.service';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  controllers: [DocumentImportController, DocumentsController],
  providers: [DocumentImportService, DocumentsService],
})
export class DocumentsModule {}
