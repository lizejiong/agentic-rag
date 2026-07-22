from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path, PurePosixPath
import zipfile

from pypdf import PdfReader
from pypdf.errors import PdfReadError

from rag_ai.ingestion.models import IngestionFailure


@dataclass(frozen=True)
class ValidatedFile:
    extension: str
    detected_mime_type: str


class FileValidator:
    _OFFICE_MEMBERS = {
        "docx": "word/document.xml",
        "xlsx": "xl/workbook.xml",
        "pptx": "ppt/presentation.xml",
    }
    _MIME_TYPES = {
        "pdf": "application/pdf",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "txt": "text/plain",
        "md": "text/markdown",
        "csv": "text/csv",
        "json": "application/json",
    }

    def __init__(
        self,
        *,
        max_archive_entries: int,
        max_expanded_bytes: int,
        max_compression_ratio: float,
        max_pdf_pages: int = 2_000,
    ) -> None:
        self._max_archive_entries = max_archive_entries
        self._max_expanded_bytes = max_expanded_bytes
        self._max_compression_ratio = max_compression_ratio
        self._max_pdf_pages = max_pdf_pages

    def validate(self, path: Path, original_file_name: str) -> ValidatedFile:
        extension = Path(original_file_name).suffix.lower().removeprefix(".")
        if extension not in self._MIME_TYPES:
            raise IngestionFailure(
                "UNSUPPORTED_DOCUMENT_FORMAT",
                "The document format is not enabled in this ingestion pipeline.",
                retryable=False,
            )
        if extension == "pdf":
            self._validate_pdf(path)
        elif extension in self._OFFICE_MEMBERS:
            self._validate_office_archive(path, extension)
        else:
            self._validate_text(path)
        return ValidatedFile(extension, self._MIME_TYPES[extension])

    def _validate_pdf(self, path: Path) -> None:
        with path.open("rb") as source:
            if source.read(5) != b"%PDF-":
                self._invalid_signature()
        try:
            reader = PdfReader(path, strict=True)
            if reader.is_encrypted:
                raise IngestionFailure(
                    "ENCRYPTED_DOCUMENT_UNSUPPORTED",
                    "Encrypted documents must be decrypted before upload.",
                    retryable=False,
                )
            page_count = len(reader.pages)
        except IngestionFailure:
            raise
        except (PdfReadError, ValueError, OSError) as error:
            raise IngestionFailure(
                "CORRUPT_DOCUMENT",
                "The PDF structure is invalid or corrupted.",
                retryable=False,
            ) from error
        if page_count > self._max_pdf_pages:
            raise IngestionFailure(
                "PDF_PAGE_LIMIT_EXCEEDED",
                f"PDF documents may contain at most {self._max_pdf_pages} pages.",
                retryable=False,
            )

    def _validate_office_archive(self, path: Path, extension: str) -> None:
        try:
            with zipfile.ZipFile(path) as archive:
                entries = archive.infolist()
                if len(entries) > self._max_archive_entries:
                    self._archive_limit("entry count")
                total_expanded = 0
                names: set[str] = set()
                for entry in entries:
                    normalized = entry.filename.replace("\\", "/")
                    member_path = PurePosixPath(normalized)
                    if member_path.is_absolute() or ".." in member_path.parts:
                        raise IngestionFailure(
                            "ARCHIVE_PATH_TRAVERSAL",
                            "The Office archive contains an unsafe path.",
                            retryable=False,
                        )
                    if entry.flag_bits & 0x1:
                        raise IngestionFailure(
                            "ENCRYPTED_DOCUMENT_UNSUPPORTED",
                            "Encrypted Office documents must be decrypted before upload.",
                            retryable=False,
                        )
                    total_expanded += entry.file_size
                    if total_expanded > self._max_expanded_bytes:
                        self._archive_limit("expanded size")
                    if entry.file_size > 1024 * 1024:
                        ratio = entry.file_size / max(entry.compress_size, 1)
                        if ratio > self._max_compression_ratio:
                            self._archive_limit("compression ratio")
                    names.add(normalized)
                if (
                    "[Content_Types].xml" not in names
                    or self._OFFICE_MEMBERS[extension] not in names
                ):
                    self._invalid_signature()
                corrupt_member = archive.testzip()
                if corrupt_member is not None:
                    raise IngestionFailure(
                        "CORRUPT_DOCUMENT",
                        "The Office archive contains a corrupt member.",
                        retryable=False,
                    )
        except IngestionFailure:
            raise
        except (zipfile.BadZipFile, OSError) as error:
            raise IngestionFailure(
                "CORRUPT_DOCUMENT",
                "The Office document is not a valid ZIP container.",
                retryable=False,
            ) from error

    def _validate_text(self, path: Path) -> None:
        with path.open("rb") as source:
            sample = source.read(64 * 1024)
        if b"\x00" in sample:
            self._invalid_signature()

    def _invalid_signature(self) -> None:
        raise IngestionFailure(
            "FILE_SIGNATURE_MISMATCH",
            "The file contents do not match the declared document format.",
            retryable=False,
        )

    def _archive_limit(self, limit: str) -> None:
        raise IngestionFailure(
            "ARCHIVE_RESOURCE_LIMIT_EXCEEDED",
            f"The Office archive exceeds the allowed {limit}.",
            retryable=False,
        )
