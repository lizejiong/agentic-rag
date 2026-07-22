import { Module } from '@nestjs/common';

import { SpacesModule } from '../spaces/spaces.module';

import { DocumentImportController } from './document-import.controller';
import { DocumentImportService } from './document-import.service';
import { DocumentIngestionConsumer } from './document-ingestion.consumer';
import { DocumentPublicationService } from './document-publication.service';
import { DocumentReconciliationService } from './document-reconciliation.service';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  imports: [SpacesModule],
  controllers: [DocumentImportController, DocumentsController],
  providers: [
    DocumentImportService,
    DocumentsService,
    DocumentPublicationService,
    DocumentIngestionConsumer,
    DocumentReconciliationService,
  ],
})
export class DocumentsModule {}
