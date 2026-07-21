from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from minio import Minio


class MinioStorage:
    def __init__(self, client: Minio, quarantine_bucket: str) -> None:
        self._client = client
        self._quarantine_bucket = quarantine_bucket

    async def stat_quarantine(self, object_key: str) -> int:
        result = await asyncio.to_thread(
            self._client.stat_object,
            self._quarantine_bucket,
            object_key,
        )
        if result.size is None:
            raise RuntimeError("Object storage did not return the quarantined object size.")
        return result.size

    async def stream_quarantine(
        self, object_key: str, *, chunk_size: int = 1024 * 1024
    ) -> AsyncIterator[bytes]:
        response = await asyncio.to_thread(
            self._client.get_object,
            self._quarantine_bucket,
            object_key,
        )
        try:
            while True:
                chunk = await asyncio.to_thread(response.read, chunk_size)
                if not chunk:
                    break
                yield chunk
        finally:
            response.close()
            response.release_conn()


def create_minio_storage(
    endpoint: str,
    access_key: str,
    secret_key: str,
    secure: bool,
    quarantine_bucket: str,
) -> MinioStorage:
    return MinioStorage(
        Minio(endpoint, access_key=access_key, secret_key=secret_key, secure=secure),
        quarantine_bucket,
    )
