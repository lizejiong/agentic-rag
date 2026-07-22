from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable

from rag_ai.infrastructure.storage.minio_storage import (
    MinioStorage,
    QuarantineIntegrityError,
)
from rag_ai.ingestion.chunking.structure_chunker import StructureChunker
from rag_ai.ingestion.models import (
    IngestionCommand,
    IngestionFailure,
    IngestionResult,
    ProcessingStage,
)
from rag_ai.ingestion.parsers.registry import ParserRegistry
from rag_ai.ingestion.security.clamav import ClamAvScanner
from rag_ai.ingestion.security.file_validation import FileValidator

ProgressReporter = Callable[[ProcessingStage, int], Awaitable[None]]


class IngestionPipeline:
    def __init__(
        self,
        *,
        storage: MinioStorage,
        scanner: ClamAvScanner,
        validator: FileValidator,
        parsers: ParserRegistry,
        chunker: StructureChunker,
        timeout_seconds: int,
    ) -> None:
        self._storage = storage
        self._scanner = scanner
        self._validator = validator
        self._parsers = parsers
        self._chunker = chunker
        self._timeout_seconds = timeout_seconds

    async def process(
        self,
        command: IngestionCommand,
        report: ProgressReporter,
    ) -> IngestionResult:
        payload = command.payload
        try:
            async with asyncio.timeout(self._timeout_seconds):
                async with self._storage.materialize_quarantine(
                    payload.object_key,
                    original_file_name=payload.original_file_name,
                    expected_bytes=payload.size_bytes,
                    expected_hash=payload.content_hash,
                ) as path:
                    await self._scanner.scan_file(path)
                    validated = await asyncio.to_thread(
                        self._validator.validate,
                        path,
                        payload.original_file_name,
                    )
                    await report(ProcessingStage.PARSING, 30)
                    parser = self._parsers.for_extension(validated.extension)
                    document = await asyncio.to_thread(
                        parser.parse,
                        path,
                        original_file_name=payload.original_file_name,
                        extension=validated.extension,
                        detected_mime_type=validated.detected_mime_type,
                    )
                    if not document.elements:
                        raise IngestionFailure(
                            "DOCUMENT_HAS_NO_CONTENT",
                            "No indexable content was found in the document.",
                            retryable=False,
                        )
                    await report(ProcessingStage.NORMALIZING, 60)
                    await report(ProcessingStage.CHUNKING, 80)
                    chunks = await asyncio.to_thread(self._chunker.chunk, document)
                    if not chunks:
                        raise IngestionFailure(
                            "DOCUMENT_HAS_NO_CHUNKS",
                            "The document did not produce any indexable chunks.",
                            retryable=False,
                        )
                    return IngestionResult(document=document, chunks=chunks)
        except QuarantineIntegrityError as error:
            raise IngestionFailure(
                str(error),
                "The quarantined object failed size or content-hash verification.",
                retryable=False,
            ) from error
        except TimeoutError as error:
            raise IngestionFailure(
                "DOCUMENT_PROCESSING_TIMEOUT",
                "The document exceeded the maximum processing time.",
                retryable=True,
            ) from error
