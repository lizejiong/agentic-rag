import { Module } from '@nestjs/common';

import { ENVIRONMENT, type Environment } from '../infrastructure/config/environment';
import { SpacesModule } from '../spaces/spaces.module';

import { DocumentImportController } from './document-import.controller';
import { DocumentImportService } from './document-import.service';
import { DocumentIngestionConsumer } from './document-ingestion.consumer';
import { DocumentUrlCaptureConsumer } from './document-url-capture.consumer';
import { DocumentUrlCaptureService } from './document-url-capture.service';
import { DocumentPublicationService } from './document-publication.service';
import { DocumentReconciliationService } from './document-reconciliation.service';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { UrlAddressPolicy } from './url-address-policy';
import { UrlContentExtractor } from './url-content-extractor';
import { URL_FETCH_OPTIONS, UrlHttpFetcher } from './url-http-fetcher';

@Module({
  imports: [SpacesModule],
  controllers: [DocumentImportController, DocumentsController],
  providers: [
    DocumentImportService,
    DocumentsService,
    DocumentPublicationService,
    DocumentIngestionConsumer,
    DocumentUrlCaptureService,
    DocumentUrlCaptureConsumer,
    UrlAddressPolicy,
    UrlHttpFetcher,
    UrlContentExtractor,
    {
      provide: URL_FETCH_OPTIONS,
      inject: [ENVIRONMENT],
      useFactory: (environment: Environment) => ({
        maxBytes: environment.URL_CAPTURE_MAX_BYTES,
        maxRedirects: environment.URL_CAPTURE_MAX_REDIRECTS,
        timeoutMilliseconds: environment.URL_CAPTURE_TIMEOUT_MS,
      }),
    },
    DocumentReconciliationService,
  ],
})
export class DocumentsModule {}
