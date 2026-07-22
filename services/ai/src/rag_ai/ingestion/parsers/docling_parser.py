from __future__ import annotations

from importlib.metadata import version
from pathlib import Path
from typing import Any

from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions, PipelineOptions
from docling.document_converter import (
    DocumentConverter,
    ExcelFormatOption,
    MarkdownFormatOption,
    PdfFormatOption,
    PowerpointFormatOption,
    WordFormatOption,
)
from docling_core.types.doc import TableItem

from rag_ai.ingestion.models import IngestionFailure
from rag_ai.ingestion.normalization.models import (
    ElementType,
    NormalizedDocument,
    NormalizedElement,
    SourceLocation,
)


class DoclingParser:
    _FORMATS = {
        "pdf": InputFormat.PDF,
        "docx": InputFormat.DOCX,
        "xlsx": InputFormat.XLSX,
        "pptx": InputFormat.PPTX,
        "md": InputFormat.MD,
    }

    def __init__(self, *, timeout_seconds: int, max_file_size: int = 200 * 1024 * 1024) -> None:
        simple_options = PipelineOptions(
            document_timeout=float(timeout_seconds),
            enable_remote_services=False,
            allow_external_plugins=False,
        )
        pdf_options = PdfPipelineOptions(
            document_timeout=float(timeout_seconds),
            enable_remote_services=False,
            allow_external_plugins=False,
            do_ocr=False,
            generate_page_images=False,
            generate_picture_images=False,
            generate_table_images=False,
            queue_max_size=20,
            layout_batch_size=2,
            table_batch_size=2,
            ocr_batch_size=1,
        )
        self._converter = DocumentConverter(
            allowed_formats=list(self._FORMATS.values()),
            format_options={
                InputFormat.PDF: PdfFormatOption(pipeline_options=pdf_options),
                InputFormat.DOCX: WordFormatOption(pipeline_options=simple_options),
                InputFormat.XLSX: ExcelFormatOption(pipeline_options=simple_options),
                InputFormat.PPTX: PowerpointFormatOption(pipeline_options=simple_options),
                InputFormat.MD: MarkdownFormatOption(pipeline_options=simple_options),
            },
        )
        self._max_file_size = max_file_size

    def parse(
        self,
        path: Path,
        *,
        original_file_name: str,
        extension: str,
        detected_mime_type: str,
    ) -> NormalizedDocument:
        if extension not in self._FORMATS:
            raise IngestionFailure(
                "UNSUPPORTED_DOCUMENT_FORMAT",
                "No Docling adapter is registered for this document format.",
                retryable=False,
            )
        try:
            result = self._converter.convert(
                path,
                raises_on_error=True,
                max_num_pages=2_000,
                max_file_size=self._max_file_size,
            )
            document = result.document
        except Exception as error:
            raise IngestionFailure(
                "DOCUMENT_PARSE_FAILED",
                "Docling could not parse the document safely.",
                retryable=False,
            ) from error

        groups: dict[str, tuple[str | None, str | None]] = {}
        for item, _depth in document.iterate_items(with_groups=True):
            if type(item).__name__ == "GroupItem":
                groups[item.self_ref] = (
                    getattr(item, "name", None),
                    self._label(item),
                )

        elements: list[NormalizedElement] = []
        for item, depth in document.iterate_items():
            text = self._text(item, document)
            if not text.strip():
                continue
            label = self._label(item)
            element_type = self._element_type(label, extension)
            elements.append(
                NormalizedElement(
                    index=len(elements),
                    type=element_type,
                    text=text.strip(),
                    heading_level=min(max(depth, 1), 12)
                    if element_type in {ElementType.TITLE, ElementType.HEADING}
                    else None,
                    location=self._location(item, extension, groups),
                    metadata={"doclingLabel": label, "selfRef": item.self_ref},
                )
            )

        return NormalizedDocument(
            title=Path(original_file_name).stem,
            detected_mime_type=detected_mime_type,
            parser_version=f"docling/{version('docling')}",
            elements=elements,
            metadata={"sourceFormat": extension, "conversionStatus": str(result.status)},
        )

    def _text(self, item: Any, document: Any) -> str:
        if isinstance(item, TableItem):
            return item.export_to_markdown(document)
        text = getattr(item, "text", "")
        if text:
            return str(text)
        caption = getattr(item, "caption_text", "")
        return str(caption(document) if callable(caption) else caption)

    def _label(self, item: Any) -> str:
        label = getattr(item, "label", "unknown")
        return str(getattr(label, "value", label))

    def _element_type(self, label: str, extension: str) -> ElementType:
        if label == "title":
            return ElementType.TITLE
        if label in {"section_header", "page_header"}:
            return ElementType.HEADING
        if label in {"list_item", "checkbox_selected", "checkbox_unselected"}:
            return ElementType.LIST_ITEM
        if label == "table":
            return ElementType.SHEET_REGION if extension == "xlsx" else ElementType.TABLE
        if label in {"caption", "picture"}:
            return ElementType.IMAGE_CAPTION
        if label == "code":
            return ElementType.CODE
        return ElementType.PARAGRAPH

    def _location(
        self,
        item: Any,
        extension: str,
        groups: dict[str, tuple[str | None, str | None]],
    ) -> SourceLocation:
        provenance = getattr(item, "prov", [])
        page_no = provenance[0].page_no if provenance else None
        bbox = provenance[0].bbox if provenance else None
        bbox_value = (bbox.l, bbox.t, bbox.r, bbox.b) if bbox is not None else None
        if extension == "pptx":
            return SourceLocation(slide=page_no, bbox=bbox_value)
        if extension == "xlsx":
            sheet = self._sheet_name(item, groups) or f"Sheet {page_no or 1}"
            cell_range = None
            if bbox is not None:
                cell_range = (
                    f"{self._column_name(round(bbox.l) + 1)}{round(bbox.t) + 1}:"
                    f"{self._column_name(max(round(bbox.r), 1))}{max(round(bbox.b), 1)}"
                )
            return SourceLocation(sheet=sheet, cell_range=cell_range, bbox=bbox_value)
        return SourceLocation(page=page_no, bbox=bbox_value)

    def _sheet_name(
        self,
        item: Any,
        groups: dict[str, tuple[str | None, str | None]],
    ) -> str | None:
        parent = getattr(item, "parent", None)
        reference = getattr(parent, "cref", None)
        if reference in groups:
            name, label = groups[reference]
            if label == "sheet":
                return name
        return None

    def _column_name(self, number: int) -> str:
        value = max(number, 1)
        result = ""
        while value:
            value, remainder = divmod(value - 1, 26)
            result = chr(65 + remainder) + result
        return result
