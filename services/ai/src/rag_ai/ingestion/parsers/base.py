from __future__ import annotations

from pathlib import Path
from typing import Protocol

from rag_ai.ingestion.normalization.models import NormalizedDocument


class DocumentParser(Protocol):
    def parse(
        self,
        path: Path,
        *,
        original_file_name: str,
        extension: str,
        detected_mime_type: str,
    ) -> NormalizedDocument: ...
