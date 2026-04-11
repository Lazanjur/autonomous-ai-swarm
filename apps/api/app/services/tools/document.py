from __future__ import annotations

import csv
import json
from io import BytesIO, StringIO
from typing import Any

from openpyxl import Workbook
from slugify import slugify

from app.services.tools.common import ToolRuntimeBase


class DocumentExportTool(ToolRuntimeBase):
    name = "document_export"

    async def export_markdown(
        self,
        title: str,
        content: str,
        *,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        request = {"title": title, "metadata": metadata or {}}
        audit, started_at = self.start_audit("export_markdown", request)
        key = f"exports/{slugify(title)}.md"
        artifact = {
            "storage_key": key,
            "path": self.storage.save_text(key, f"# {title}\n\n{content}\n"),
            "content_type": "text/markdown",
        }
        payload = {"title": title, "artifacts": [artifact], "metadata": metadata or {}}
        audit = self.finalize_audit(audit, started_at, status="completed", response=payload, artifacts=[artifact])
        return self.result(operation="export_markdown", status="completed", payload=payload, audit=audit)

    async def export_json(self, title: str, payload: dict[str, Any] | list[Any]) -> dict[str, Any]:
        request = {"title": title}
        audit, started_at = self.start_audit("export_json", request)
        key = f"exports/{slugify(title)}.json"
        artifact = {
            "storage_key": key,
            "path": self.storage.save_text(key, json.dumps(payload, indent=2, ensure_ascii=False)),
            "content_type": "application/json",
        }
        result_payload = {"title": title, "artifacts": [artifact]}
        audit = self.finalize_audit(
            audit,
            started_at,
            status="completed",
            response={"title": title},
            artifacts=[artifact],
        )
        return self.result(operation="export_json", status="completed", payload=result_payload, audit=audit)

    async def export_table(
        self,
        title: str,
        rows: list[dict[str, Any]],
        *,
        format: str = "csv",
    ) -> dict[str, Any]:
        request = {"title": title, "format": format, "row_count": len(rows)}
        audit, started_at = self.start_audit("export_table", request)
        headers = sorted({key for row in rows for key in row.keys()}) if rows else []

        if format == "csv":
            csv_buffer = StringIO()
            writer = csv.DictWriter(csv_buffer, fieldnames=headers)
            writer.writeheader()
            writer.writerows(rows)
            key = f"exports/{slugify(title)}.csv"
            artifact = {
                "storage_key": key,
                "path": self.storage.save_text(key, csv_buffer.getvalue()),
                "content_type": "text/csv",
            }
        elif format == "xlsx":
            workbook = Workbook()
            sheet = workbook.active
            sheet.title = "Data"
            if headers:
                sheet.append(headers)
                for row in rows:
                    sheet.append([row.get(header) for header in headers])
            key = f"exports/{slugify(title)}.xlsx"
            payload_bytes = BytesIO()
            workbook.save(payload_bytes)
            artifact = {
                "storage_key": key,
                "path": self.storage.save_bytes(key, payload_bytes.getvalue()),
                "content_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            }
        else:
            error = f"Unsupported tabular export format `{format}`."
            audit = self.finalize_audit(audit, started_at, status="failed", error=error)
            return self.result(
                operation="export_table",
                status="failed",
                payload={"error": error, "artifacts": []},
                audit=audit,
            )

        payload = {"title": title, "headers": headers, "row_count": len(rows), "artifacts": [artifact]}
        audit = self.finalize_audit(audit, started_at, status="completed", response=payload, artifacts=[artifact])
        return self.result(operation="export_table", status="completed", payload=payload, audit=audit)

    async def export_report_bundle(
        self,
        title: str,
        sections: list[dict[str, str]],
        *,
        table_rows: list[dict[str, Any]] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        request = {
            "title": title,
            "section_count": len(sections),
            "table_rows": len(table_rows or []),
            "metadata": metadata or {},
        }
        audit, started_at = self.start_audit("export_report_bundle", request)

        markdown_body = [f"# {title}", ""]
        for section in sections:
            markdown_body.append(f"## {section.get('heading', 'Section')}")
            markdown_body.append("")
            markdown_body.append(section.get("content", ""))
            markdown_body.append("")
        markdown_artifact = {
            "storage_key": f"exports/{slugify(title)}-report.md",
            "path": self.storage.save_text(
                f"exports/{slugify(title)}-report.md",
                "\n".join(markdown_body),
            ),
            "content_type": "text/markdown",
        }
        json_artifact = {
            "storage_key": f"exports/{slugify(title)}-report.json",
            "path": self.storage.save_json(
                f"exports/{slugify(title)}-report.json",
                {
                    "title": title,
                    "sections": sections,
                    "table_rows": table_rows or [],
                    "metadata": metadata or {},
                },
            ),
            "content_type": "application/json",
        }
        artifacts = [markdown_artifact, json_artifact]
        if table_rows:
            table_result = await self.export_table(title=f"{title}-table", rows=table_rows, format="xlsx")
            artifacts.extend(table_result.get("artifacts", []))

        payload = {
            "title": title,
            "section_count": len(sections),
            "artifacts": artifacts,
            "metadata": metadata or {},
        }
        audit = self.finalize_audit(audit, started_at, status="completed", response=payload, artifacts=artifacts)
        return self.result(operation="export_report_bundle", status="completed", payload=payload, audit=audit)
