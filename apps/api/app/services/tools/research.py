from __future__ import annotations

from urllib.parse import quote_plus

import httpx
from bs4 import BeautifulSoup

from app.services.tools.common import ToolRuntimeBase


class WebResearchTool(ToolRuntimeBase):
    name = "web_search"

    async def execute(self, query: str, max_results: int = 5) -> dict:
        audit, started_at = self.start_audit(
            "execute",
            {"query": query, "max_results": max_results},
        )
        url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
        try:
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
                response = await client.get(url)
                response.raise_for_status()
            soup = BeautifulSoup(response.text, "html.parser")
            items = []
            for link in soup.select(".result__a")[:max_results]:
                items.append(
                    {
                        "title": link.get_text(" ", strip=True),
                        "url": link.get("href"),
                    }
                )
            if items:
                payload = {"query": query, "results": items}
                audit = self.finalize_audit(
                    audit,
                    started_at,
                    status="completed",
                    response={"result_count": len(items)},
                )
                return self.result(operation="execute", status="completed", payload=payload, audit=audit)
        except Exception:
            pass

        payload = {
            "query": query,
            "results": [
                {
                    "title": "Offline research fallback",
                    "url": "",
                }
            ],
        }
        audit = self.finalize_audit(
            audit,
            started_at,
            status="completed",
            response={"result_count": 1, "fallback": True},
        )
        return self.result(operation="execute", status="completed", payload=payload, audit=audit)
