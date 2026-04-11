from __future__ import annotations

import json
import mimetypes
from pathlib import Path

from app.core.config import get_settings

settings = get_settings()


class StorageService:
    def __init__(self) -> None:
        self.root = Path(__file__).resolve().parents[4] / "var" / "artifacts"
        self.root.mkdir(parents=True, exist_ok=True)

    def save_text(self, key: str, content: str) -> str:
        path = self.resolve(key, create_parent=True)
        path.write_text(content, encoding="utf-8")
        return str(path)

    def save_bytes(self, key: str, content: bytes) -> str:
        path = self.resolve(key, create_parent=True)
        path.write_bytes(content)
        return str(path)

    def save_json(self, key: str, payload: dict | list) -> str:
        return self.save_text(key, json.dumps(payload, indent=2, ensure_ascii=False))

    def resolve(self, key: str, *, create_parent: bool = False) -> Path:
        normalized = Path(key.replace("\\", "/"))
        path = (self.root / normalized).resolve()
        if self.root not in path.parents and path != self.root:
            raise ValueError("Storage key resolves outside the storage root.")
        if create_parent:
            path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def guess_content_type(self, key: str) -> str:
        return mimetypes.guess_type(key)[0] or "application/octet-stream"
