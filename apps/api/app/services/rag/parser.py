from __future__ import annotations

import json
import mimetypes
import re
import zipfile
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from xml.etree import ElementTree as ET

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


TEXT_LIKE_EXTENSIONS = {
    ".txt",
    ".md",
    ".mdx",
    ".rst",
    ".log",
    ".py",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".java",
    ".c",
    ".cpp",
    ".cc",
    ".cxx",
    ".h",
    ".hpp",
    ".cs",
    ".go",
    ".rs",
    ".rb",
    ".php",
    ".swift",
    ".kt",
    ".kts",
    ".scala",
    ".sql",
    ".sh",
    ".bash",
    ".zsh",
    ".ps1",
    ".bat",
    ".cmd",
    ".yaml",
    ".yml",
    ".toml",
    ".ini",
    ".cfg",
    ".conf",
    ".env",
    ".properties",
    ".gradle",
    ".gitignore",
    ".dockerfile",
    ".tex",
}

PLACEHOLDER_ONLY_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".svg",
    ".bmp",
    ".tif",
    ".tiff",
    ".ico",
    ".heic",
    ".mp3",
    ".wav",
    ".m4a",
    ".aac",
    ".ogg",
    ".flac",
    ".mp4",
    ".mov",
    ".avi",
    ".mkv",
    ".webm",
    ".zip",
    ".7z",
    ".rar",
    ".tar",
    ".gz",
    ".tgz",
    ".doc",
    ".ppt",
    ".pptx",
    ".odt",
    ".ods",
    ".odp",
    ".pages",
    ".numbers",
    ".key",
    ".epub",
    ".ipynb",
}


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

        if extension == ".jsonl":
            lines = [
                json.loads(line)
                for line in payload.decode("utf-8", errors="ignore").splitlines()
                if line.strip()
            ]
            metadata["row_count"] = len(lines)
            content = json.dumps(lines, indent=2, ensure_ascii=False)
            return ParsedUpload(content, "application/json", "json", ".jsonl", metadata)

        if extension == ".csv" or mime_type in {"text/csv", "application/csv"}:
            frame = pd.read_csv(BytesIO(payload))
            metadata["row_count"] = int(frame.shape[0])
            metadata["column_count"] = int(frame.shape[1])
            content = frame.to_csv(index=False)
            return ParsedUpload(content, "text/csv", "csv", ".csv", metadata)

        if extension == ".tsv":
            frame = pd.read_csv(BytesIO(payload), sep="\t")
            metadata["row_count"] = int(frame.shape[0])
            metadata["column_count"] = int(frame.shape[1])
            content = frame.to_csv(index=False)
            return ParsedUpload(content, "text/tab-separated-values", "csv", ".tsv", metadata)

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

        if extension == ".pptx" or "presentationml" in mime_type:
            content, pptx_metadata = self._extract_pptx_text(payload)
            metadata.update(pptx_metadata)
            return ParsedUpload(
                content,
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                "presentation",
                ".pptx",
                metadata,
            )

        if extension in {".xml"} or mime_type in {"application/xml", "text/xml"}:
            xml_text = payload.decode("utf-8", errors="ignore")
            content = BeautifulSoup(xml_text, "html.parser").get_text(" ", strip=True)
            return ParsedUpload(content, mime_type, "xml", extension or ".xml", metadata)

        if extension == ".rtf":
            rtf_text = payload.decode("utf-8", errors="ignore")
            content = self._strip_rtf(rtf_text)
            return ParsedUpload(content, "application/rtf", "document", ".rtf", metadata)

        if extension in {".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".env", ".properties"}:
            content = payload.decode("utf-8", errors="ignore")
            return ParsedUpload(content, mime_type, "config", extension, metadata)

        if extension == ".ipynb":
            notebook = json.loads(payload.decode("utf-8", errors="ignore"))
            cells = notebook.get("cells", [])
            metadata["cell_count"] = len(cells)
            text_blocks: list[str] = []
            for cell in cells:
                source = cell.get("source", [])
                if isinstance(source, list):
                    source_text = "".join(source).strip()
                else:
                    source_text = str(source).strip()
                if source_text:
                    text_blocks.append(source_text)
            content = "\n\n".join(text_blocks)
            return ParsedUpload(content, "application/x-ipynb+json", "notebook", ".ipynb", metadata)

        if extension in TEXT_LIKE_EXTENSIONS or mime_type.startswith("text/"):
            content = payload.decode("utf-8", errors="ignore")
            return ParsedUpload(content, mime_type, self._source_type_for(extension), extension or ".txt", metadata)

        if extension in PLACEHOLDER_ONLY_EXTENSIONS or self._is_placeholder_mime(mime_type):
            content = self._build_binary_placeholder(filename, mime_type, extension or Path(filename).suffix.lower())
            metadata["attachment_only"] = True
            metadata["extracted_text"] = False
            return ParsedUpload(
                content,
                mime_type,
                self._source_type_for(extension),
                extension or Path(filename).suffix.lower() or ".bin",
                metadata,
            )

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
            ".mdx": "markdown",
            ".html": "html",
            ".htm": "html",
            ".json": "json",
            ".jsonl": "json",
            ".csv": "csv",
            ".tsv": "csv",
            ".xls": "spreadsheet",
            ".xlsx": "spreadsheet",
            ".pdf": "pdf",
            ".docx": "docx",
            ".doc": "document",
            ".rtf": "document",
            ".pptx": "presentation",
            ".ppt": "presentation",
            ".xml": "xml",
            ".yaml": "config",
            ".yml": "config",
            ".toml": "config",
            ".ini": "config",
            ".cfg": "config",
            ".conf": "config",
            ".env": "config",
            ".ipynb": "notebook",
            ".png": "image",
            ".jpg": "image",
            ".jpeg": "image",
            ".gif": "image",
            ".webp": "image",
            ".svg": "image",
            ".bmp": "image",
            ".tif": "image",
            ".tiff": "image",
            ".ico": "image",
            ".heic": "image",
            ".mp3": "audio",
            ".wav": "audio",
            ".m4a": "audio",
            ".aac": "audio",
            ".ogg": "audio",
            ".flac": "audio",
            ".mp4": "video",
            ".mov": "video",
            ".avi": "video",
            ".mkv": "video",
            ".webm": "video",
            ".zip": "archive",
            ".7z": "archive",
            ".rar": "archive",
            ".tar": "archive",
            ".gz": "archive",
            ".tgz": "archive",
        }.get(extension, "text")

    def _extract_pptx_text(self, payload: bytes) -> tuple[str, dict]:
        slide_text: list[str] = []
        slide_count = 0
        with zipfile.ZipFile(BytesIO(payload)) as archive:
            slide_names = sorted(name for name in archive.namelist() if name.startswith("ppt/slides/slide"))
            slide_count = len(slide_names)
            for slide_name in slide_names:
                try:
                    root = ET.fromstring(archive.read(slide_name))
                except ET.ParseError:
                    continue
                texts = [node.text.strip() for node in root.iter() if node.text and node.text.strip()]
                if texts:
                    slide_text.append("\n".join(texts))
        metadata = {"slide_count": slide_count}
        content = "\n\n".join(slide_text).strip()
        if not content:
            content = "Presentation attached. The original slide deck is preserved as a source artifact."
            metadata["attachment_only"] = True
        return content, metadata

    def _strip_rtf(self, value: str) -> str:
        text = re.sub(r"\\'[0-9a-fA-F]{2}", " ", value)
        text = re.sub(r"\\[a-zA-Z]+-?\d* ?", " ", text)
        text = re.sub(r"[{}]", " ", text)
        text = re.sub(r"\s+", " ", text)
        return text.strip()

    def _is_placeholder_mime(self, mime_type: str) -> bool:
        normalized = (mime_type or "").lower()
        return normalized.startswith(("image/", "audio/", "video/")) or normalized in {
            "application/zip",
            "application/x-zip-compressed",
            "application/x-7z-compressed",
            "application/x-rar-compressed",
            "application/vnd.ms-powerpoint",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "application/msword",
            "application/vnd.oasis.opendocument.text",
            "application/vnd.oasis.opendocument.spreadsheet",
            "application/vnd.oasis.opendocument.presentation",
            "application/epub+zip",
        }

    def _build_binary_placeholder(self, filename: str, mime_type: str, extension: str) -> str:
        return (
            f"Attached file: {filename}\n"
            f"Type: {mime_type or 'application/octet-stream'}\n"
            f"Extension: {extension or '.bin'}\n"
            "This file was attached to the workspace and preserved as a source artifact. "
            "Its original binary content is available for downstream tools, previews, and exports."
        )
