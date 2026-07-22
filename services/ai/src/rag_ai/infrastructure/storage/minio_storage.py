from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory

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

    @asynccontextmanager
    async def materialize_quarantine(
        self,
        object_key: str,
        *,
        original_file_name: str,
        expected_bytes: int,
        expected_hash: str,
    ) -> AsyncIterator[Path]:
        with TemporaryDirectory(prefix="atlas-ingestion-") as directory:
            suffix = Path(original_file_name).suffix.lower()
            path = Path(directory) / f"source{suffix}"
            digest = sha256()
            actual_bytes = 0
            with path.open("wb") as target:
                async for chunk in self.stream_quarantine(object_key):
                    actual_bytes += len(chunk)
                    if actual_bytes > expected_bytes:
                        raise QuarantineIntegrityError("QUARANTINE_SIZE_MISMATCH")
                    digest.update(chunk)
                    await asyncio.to_thread(target.write, chunk)
            if actual_bytes != expected_bytes:
                raise QuarantineIntegrityError("QUARANTINE_SIZE_MISMATCH")
            if digest.hexdigest() != expected_hash:
                raise QuarantineIntegrityError("QUARANTINE_HASH_MISMATCH")
            yield path


class QuarantineIntegrityError(Exception):
    pass


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
