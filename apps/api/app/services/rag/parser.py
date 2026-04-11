from __future__ import annotations

import json
import mimetypes
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

import pandas as pd
from bs4 import BeautifulSoup
from docx import Document as DocxDocument
from pypdf import PdfReader


@dataclass
class ParsedUpload:
    content_text: str
    mime_type: str
    source_type: str
    extension: str
    metadata: dict


class DocumentParserService:
    def parse_bytes(self, filename: str, content_type: str | None, payload: bytes) -> ParsedUpload:
        extension = Path(filename).suffix.lower()
        mime_type = content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
        metadata: dict = {"filename": filename, "byte_size": len(payload)}

        if extension in {".html", ".htm"} or mime_type == "text/html":
            html = payload.decode("utf-8", errors="ignore")
            content = BeautifulSoup(html, "html.parser").get_text(" ", strip=True)
            return ParsedUpload(content, "text/html", "html", extension or ".html", metadata)

        if extension == ".json" or mime_type == "application/json":
            obj = json.loads(payload.decode("utf-8", errors="ignore"))
            content = json.dumps(obj, indent=2, ensure_ascii=False)
            metadata["top_level_type"] = type(obj).__name__
            return ParsedUpload(content, "application/json", "json", ".json", metadata)

        if extension == ".csv" or mime_type in {"text/csv", "application/csv"}:
            frame = pd.read_csv(BytesIO(payload))
            metadata["row_count"] = int(frame.shape[0])
            metadata["column_count"] = int(frame.shape[1])
            content = frame.to_csv(index=False)
            return ParsedUpload(content, "text/csv", "csv", ".csv", metadata)

        if extension in {".xls", ".xlsx"} or "spreadsheet" in mime_type or "excel" in mime_type:
            frame = pd.read_excel(BytesIO(payload))
            metadata["row_count"] = int(frame.shape[0])
            metadata["column_count"] = int(frame.shape[1])
            content = frame.to_csv(index=False)
            return ParsedUpload(
                content,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "spreadsheet",
                extension or ".xlsx",
                metadata,
            )

        if extension == ".pdf" or mime_type == "application/pdf":
            reader = PdfReader(BytesIO(payload))
            pages = [page.extract_text() or "" for page in reader.pages]
            metadata["page_count"] = len(pages)
            content = "\n\n".join(pages).strip()
            return ParsedUpload(content, "application/pdf", "pdf", ".pdf", metadata)

        if extension == ".docx" or "wordprocessingml" in mime_type:
            document = DocxDocument(BytesIO(payload))
            paragraphs = [paragraph.text for paragraph in document.paragraphs if paragraph.text.strip()]
            metadata["paragraph_count"] = len(paragraphs)
            content = "\n\n".join(paragraphs)
            return ParsedUpload(
                content,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "docx",
                ".docx",
                metadata,
            )

        if extension in {".txt", ".md"} or mime_type.startswith("text/"):
            content = payload.decode("utf-8", errors="ignore")
            return ParsedUpload(content, mime_type, self._source_type_for(extension), extension, metadata)

        try:
            content = payload.decode("utf-8", errors="ignore")
        except Exception as exc:  # pragma: no cover - defensive fallback
            raise ValueError(f"Unsupported file type for `{filename}`.") from exc

        if not content.strip():
            raise ValueError(f"Unsupported or empty file content for `{filename}`.")

        return ParsedUpload(content, mime_type, self._source_type_for(extension), extension or ".txt", metadata)

    def _source_type_for(self, extension: str) -> str:
        return {
            ".txt": "text",
            ".md": "markdown",
            ".html": "html",
            ".htm": "html",
            ".json": "json",
            ".csv": "csv",
            ".xls": "spreadsheet",
            ".xlsx": "spreadsheet",
            ".pdf": "pdf",
            ".docx": "docx",
        }.get(extension, "text")
