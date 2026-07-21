import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Transform } from 'node:stream';

import { Inject, Injectable, OnModuleInit } from '@nestjs/common';

import { ENVIRONMENT, type Environment } from '../config/environment';

export const MINIO_CLIENT = Symbol('MINIO_CLIENT');

export interface ObjectStorageClient {
  bucketExists(bucketName: string): Promise<boolean>;
  getObject(bucketName: string, objectName: string): Promise<Readable>;
  putObject(
    bucketName: string,
    objectName: string,
    stream: Readable,
    size: number,
    metadata?: Record<string, string>,
  ): Promise<unknown>;
  removeObject(bucketName: string, objectName: string): Promise<void>;
  statObject(bucketName: string, objectName: string): Promise<unknown>;
  copyObject(
    targetBucketName: string,
    targetObjectName: string,
    sourceBucketNameAndObjectName: string,
  ): Promise<unknown>;
}

export interface StoredUpload {
  objectKey: string;
  contentHash: string;
  sizeBytes: number;
}

class UploadMeter extends Transform {
  private readonly hash = createHash('sha256');
  private bytes = 0;

  constructor(private readonly maxBytes: number) {
    super();
  }

  get sizeBytes(): number {
    return this.bytes;
  }

  digest(): string {
    return this.hash.digest('hex');
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void,
  ): void {
    this.bytes += chunk.length;
    if (this.bytes > this.maxBytes) {
      callback(new Error('OBJECT_SIZE_LIMIT_EXCEEDED'));
      return;
    }
    this.hash.update(chunk);
    callback(null, chunk);
  }
}

@Injectable()
export class ObjectStorageService implements OnModuleInit {
  private readonly quarantineBucket: string;
  private readonly documentBucket: string;

  constructor(
    @Inject(MINIO_CLIENT) private readonly client: ObjectStorageClient,
    @Inject(ENVIRONMENT) environment: Environment,
  ) {
    this.quarantineBucket = environment.MINIO_QUARANTINE_BUCKET;
    this.documentBucket = environment.MINIO_DOCUMENT_BUCKET;
  }

  async onModuleInit(): Promise<void> {
    const buckets = [this.quarantineBucket, this.documentBucket];
    const existence = await Promise.all(buckets.map((bucket) => this.client.bucketExists(bucket)));
    const missingBucket = buckets.find((_bucket, index) => !existence[index]);
    if (missingBucket) {
      throw new Error(`Required object storage bucket does not exist: ${missingBucket}`);
    }
  }

  async putQuarantineObject(input: {
    importId: string;
    source: Readable;
    expectedBytes: number;
    maxBytes: number;
    contentType: string;
  }): Promise<StoredUpload> {
    if (input.expectedBytes <= 0 || input.expectedBytes > input.maxBytes) {
      throw new Error('INVALID_OBJECT_SIZE');
    }

    const objectKey = `imports/${input.importId}`;
    const meter = new UploadMeter(input.maxBytes);
    input.source.pipe(meter);

    try {
      await this.client.putObject(this.quarantineBucket, objectKey, meter, input.expectedBytes, {
        'content-type': input.contentType,
      });
      if (meter.sizeBytes !== input.expectedBytes) {
        throw new Error('OBJECT_SIZE_MISMATCH');
      }
      return {
        objectKey,
        contentHash: meter.digest(),
        sizeBytes: meter.sizeBytes,
      };
    } catch (error) {
      input.source.destroy();
      meter.destroy();
      await this.client.removeObject(this.quarantineBucket, objectKey).catch(() => undefined);
      throw error;
    }
  }

  openQuarantineObject(objectKey: string): Promise<Readable> {
    return this.client.getObject(this.quarantineBucket, objectKey);
  }

  async promoteByHash(quarantineObjectKey: string, contentHash: string): Promise<string> {
    const objectKey = `sha256/${contentHash.slice(0, 2)}/${contentHash}`;
    if (await this.objectExists(this.documentBucket, objectKey)) {
      return objectKey;
    }
    await this.client.copyObject(
      this.documentBucket,
      objectKey,
      `/${this.quarantineBucket}/${quarantineObjectKey}`,
    );
    return objectKey;
  }

  deleteQuarantineObject(objectKey: string): Promise<void> {
    return this.client.removeObject(this.quarantineBucket, objectKey);
  }

  deleteDocumentObject(objectKey: string): Promise<void> {
    return this.client.removeObject(this.documentBucket, objectKey);
  }

  private async objectExists(bucket: string, objectKey: string): Promise<boolean> {
    try {
      await this.client.statObject(bucket, objectKey);
      return true;
    } catch (error) {
      if (this.isNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  private isNotFound(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }
    const code = 'code' in error ? error.code : undefined;
    return code === 'NotFound' || code === 'NoSuchKey';
  }
}
