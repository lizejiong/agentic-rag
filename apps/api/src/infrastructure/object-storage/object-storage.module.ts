import { Global, Module } from '@nestjs/common';
import { Client } from 'minio';

import { ENVIRONMENT, type Environment } from '../config/environment';
import {
  MINIO_CLIENT,
  ObjectStorageService,
  type ObjectStorageClient,
} from './object-storage.service';

@Global()
@Module({
  providers: [
    {
      provide: MINIO_CLIENT,
      inject: [ENVIRONMENT],
      useFactory: (environment: Environment): ObjectStorageClient =>
        new Client({
          endPoint: environment.MINIO_ENDPOINT,
          port: environment.MINIO_PORT,
          useSSL: environment.MINIO_USE_SSL,
          accessKey: environment.MINIO_ACCESS_KEY,
          secretKey: environment.MINIO_SECRET_KEY,
        }),
    },
    ObjectStorageService,
  ],
  exports: [ObjectStorageService],
})
export class ObjectStorageModule {}
