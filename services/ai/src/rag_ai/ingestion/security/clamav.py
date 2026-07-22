from __future__ import annotations

import asyncio
from pathlib import Path
import struct

from rag_ai.ingestion.models import IngestionFailure


class ClamAvScanner:
    def __init__(self, host: str, port: int, *, timeout_seconds: float, required: bool) -> None:
        self._host = host
        self._port = port
        self._timeout_seconds = timeout_seconds
        self._required = required

    async def scan_file(self, path: Path) -> None:
        try:
            async with asyncio.timeout(self._timeout_seconds):
                reader, writer = await asyncio.open_connection(self._host, self._port)
                try:
                    writer.write(b"zINSTREAM\0")
                    await writer.drain()
                    with path.open("rb") as source:
                        while chunk := await asyncio.to_thread(source.read, 1024 * 1024):
                            writer.write(struct.pack(">I", len(chunk)))
                            writer.write(chunk)
                            await writer.drain()
                    writer.write(struct.pack(">I", 0))
                    await writer.drain()
                    response = (
                        (await reader.readuntil(b"\0"))
                        .rstrip(b"\0")
                        .decode("utf-8", errors="replace")
                    )
                finally:
                    writer.close()
                    await writer.wait_closed()
        except (OSError, TimeoutError, asyncio.IncompleteReadError) as error:
            if not self._required:
                return
            raise IngestionFailure(
                "VIRUS_SCANNER_UNAVAILABLE",
                "The malware scanner is unavailable; the document remains quarantined.",
                retryable=True,
            ) from error

        if response.endswith(" OK"):
            return
        if response.endswith(" FOUND"):
            signature = response.removeprefix("stream: ").removesuffix(" FOUND")
            raise IngestionFailure(
                "VIRUS_FOUND",
                f"Malware was detected ({signature[:200]}).",
                retryable=False,
            )
        raise IngestionFailure(
            "VIRUS_SCAN_ERROR",
            "The malware scanner could not determine a safe result.",
            retryable=True,
        )
