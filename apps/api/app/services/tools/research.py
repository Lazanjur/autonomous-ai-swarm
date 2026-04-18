from __future__ import annotations

import asyncio
import csv
import json
from io import StringIO
from typing import Any
from urllib.parse import parse_qs, quote_plus, unquote, urlparse

import httpx
from bs4 import BeautifulSoup
from slugify import slugify

from app.services.tools.common import ToolRuntimeBase


class WebResearchTool(ToolRuntimeBase):
    name = "web_search"

    async def execute(
        self,
        query: str,
        max_results: int = 5,
        *,
        verify_sources: bool = True,
        include_snippets: bool = True,
    ) -> dict[str, Any]:
        audit, started_at = self.start_audit(
            "search",
            {
                "query": query,
                "max_results": max_results,
                "verify_sources": verify_sources,
                "include_snippets": include_snippets,
            },
        )
        try:
            results = await self._search_query(
                query,
                max_results=max_results,
                verify_sources=verify_sources,
                include_snippets=include_snippets,
            )
            if not results:
                raise ValueError("No search results returned.")

            citations = self._assign_citations(results)
            payload = {
                "query": query,
                "results": results,
                "citations": citations,
                "result_count": len(results),
                "verified_count": sum(1 for item in results if item.get("verified")),
            }
            audit = self.finalize_audit(
                audit,
                started_at,
                status="completed",
                response={
                    "result_count": payload["result_count"],
                    "verified_count": payload["verified_count"],
                },
            )
            return self.result(operation="search", status="completed", payload=payload, audit=audit)
        except Exception as exc:
            payload = {
                "query": query,
                "results": [
                    {
                        "title": "Offline research fallback",
                        "url": "",
                        "snippet": "Search could not complete from the live web, so only an offline placeholder result is available.",
                        "verified": False,
                        "error": f"{exc.__class__.__name__}: {exc}",
                    }
                ],
                "citations": [{"id": "S1", "title": "Offline research fallback", "url": "", "verified": False}],
                "result_count": 1,
                "verified_count": 0,
                "fallback": True,
            }
            audit = self.finalize_audit(
                audit,
                started_at,
                status="completed",
                response={"result_count": 1, "verified_count": 0, "fallback": True},
            )
            return self.result(operation="search", status="completed", payload=payload, audit=audit)

    async def execute_batch(
        self,
        queries: list[str],
        max_results: int = 3,
        *,
        verify_sources: bool = True,
        include_snippets: bool = True,
    ) -> dict[str, Any]:
        cleaned_queries = []
        seen_queries: set[str] = set()
        for raw_query in queries:
            query = str(raw_query).strip()
            if not query:
                continue
            lowered = query.lower()
            if lowered in seen_queries:
                continue
            seen_queries.add(lowered)
            cleaned_queries.append(query)

        audit, started_at = self.start_audit(
            "batch_search",
            {
                "queries": cleaned_queries,
                "max_results": max_results,
                "verify_sources": verify_sources,
                "include_snippets": include_snippets,
            },
        )

        if not cleaned_queries:
            error = "batch_search requires at least one non-empty query."
            audit = self.finalize_audit(audit, started_at, status="failed", error=error)
            return self.result(
                operation="batch_search",
                status="failed",
                payload={"queries": [], "results": [], "groups": [], "error": error},
                audit=audit,
            )

        grouped_results = await asyncio.gather(
            *[
                self._search_query(
                    query,
                    max_results=max_results,
                    verify_sources=verify_sources,
                    include_snippets=include_snippets,
                )
                for query in cleaned_queries
            ]
        )

        groups: list[dict[str, Any]] = []
        for query, results in zip(cleaned_queries, grouped_results, strict=False):
            groups.append(
                {
                    "query": query,
                    "results": results,
                    "result_count": len(results),
                    "verified_count": sum(1 for item in results if item.get("verified")),
                }
            )

        deduped_results = self._dedupe_results(
            item
            for result_group in grouped_results
            for item in result_group
        )
        citations = self._assign_citations(deduped_results)

        citation_lookup = {
            (item.get("final_url") or item.get("url") or item.get("title") or "").strip().lower(): item.get("citation_id")
            for item in deduped_results
        }
        for group in groups:
            for item in group["results"]:
                identity = (item.get("final_url") or item.get("url") or item.get("title") or "").strip().lower()
                if identity and citation_lookup.get(identity):
                    item["citation_id"] = citation_lookup[identity]

        payload = {
            "queries": cleaned_queries,
            "groups": groups,
            "results": deduped_results,
            "citations": citations,
            "result_count": len(deduped_results),
            "verified_count": sum(1 for item in deduped_results if item.get("verified")),
        }
        audit = self.finalize_audit(
            audit,
            started_at,
            status="completed",
            response={
                "query_count": len(cleaned_queries),
                "result_count": payload["result_count"],
                "verified_count": payload["verified_count"],
            },
        )
        return self.result(operation="batch_search", status="completed", payload=payload, audit=audit)

    async def extract_structured(
        self,
        urls: list[str],
        *,
        export_format: str = "json",
        title: str = "web-research-extract",
    ) -> dict[str, Any]:
        cleaned_urls = self._clean_urls(urls)
        audit, started_at = self.start_audit(
            "extract_structured",
            {
                "urls": cleaned_urls,
                "export_format": export_format,
                "title": title,
            },
        )
        if not cleaned_urls:
            error = "extract_structured requires at least one valid URL."
            audit = self.finalize_audit(audit, started_at, status="failed", error=error)
            return self.result(
                operation="extract_structured",
                status="failed",
                payload={"urls": [], "rows": [], "headers": [], "artifacts": [], "error": error},
                audit=audit,
            )

        rows = await self._extract_rows_from_urls(cleaned_urls)
        artifacts = self._save_structured_artifacts(title, rows, export_format=export_format)
        payload = {
            "urls": cleaned_urls,
            "rows": rows,
            "headers": sorted({key for row in rows for key in row.keys()}) if rows else [],
            "row_count": len(rows),
            "artifacts": artifacts,
        }
        audit = self.finalize_audit(
            audit,
            started_at,
            status="completed",
            response={"row_count": len(rows), "artifact_count": len(artifacts)},
            artifacts=artifacts,
        )
        return self.result(operation="extract_structured", status="completed", payload=payload, audit=audit)

    async def build_pipeline(
        self,
        *,
        query: str | None = None,
        queries: list[str] | None = None,
        max_results: int = 3,
        verify_sources: bool = True,
        include_snippets: bool = True,
        export_format: str = "both",
        title: str | None = None,
    ) -> dict[str, Any]:
        query_list = [item for item in (queries or []) if str(item).strip()]
        if query and str(query).strip():
            query_list.insert(0, str(query).strip())

        cleaned_queries = []
        seen_queries: set[str] = set()
        for item in query_list:
            lowered = item.lower()
            if lowered in seen_queries:
                continue
            seen_queries.add(lowered)
            cleaned_queries.append(item)

        audit, started_at = self.start_audit(
            "build_pipeline",
            {
                "queries": cleaned_queries,
                "max_results": max_results,
                "verify_sources": verify_sources,
                "include_snippets": include_snippets,
                "export_format": export_format,
                "title": title,
            },
        )

        if not cleaned_queries:
            error = "build_pipeline requires a `query` or `queries` input."
            audit = self.finalize_audit(audit, started_at, status="failed", error=error)
            return self.result(
                operation="build_pipeline",
                status="failed",
                payload={"queries": [], "results": [], "rows": [], "artifacts": [], "error": error},
                audit=audit,
            )

        if len(cleaned_queries) == 1:
            results = await self._search_query(
                cleaned_queries[0],
                max_results=max_results,
                verify_sources=verify_sources,
                include_snippets=include_snippets,
            )
            groups = [
                {
                    "query": cleaned_queries[0],
                    "results": results,
                    "result_count": len(results),
                    "verified_count": sum(1 for item in results if item.get("verified")),
                }
            ]
        else:
            grouped_results = await asyncio.gather(
                *[
                    self._search_query(
                        search_query,
                        max_results=max_results,
                        verify_sources=verify_sources,
                        include_snippets=include_snippets,
                    )
                    for search_query in cleaned_queries
                ]
            )
            groups = [
                {
                    "query": search_query,
                    "results": results,
                    "result_count": len(results),
                    "verified_count": sum(1 for item in results if item.get("verified")),
                }
                for search_query, results in zip(cleaned_queries, grouped_results, strict=False)
            ]
            results = self._dedupe_results(
                item
                for result_group in grouped_results
                for item in result_group
            )

        citations = self._assign_citations(results)
        rows = [self._structured_row_from_result(item) for item in results]
        artifact_title = title or f"{cleaned_queries[0]} research pipeline"
        artifacts = self._save_structured_artifacts(artifact_title, rows, export_format=export_format)

        payload = {
            "queries": cleaned_queries,
            "groups": groups,
            "results": results,
            "citations": citations,
            "rows": rows,
            "headers": sorted({key for row in rows for key in row.keys()}) if rows else [],
            "result_count": len(results),
            "verified_count": sum(1 for item in results if item.get("verified")),
            "artifacts": artifacts,
        }
        audit = self.finalize_audit(
            audit,
            started_at,
            status="completed",
            response={
                "query_count": len(cleaned_queries),
                "result_count": len(results),
                "row_count": len(rows),
                "artifact_count": len(artifacts),
            },
            artifacts=artifacts,
        )
        return self.result(operation="build_pipeline", status="completed", payload=payload, audit=audit)

    async def _search_query(
        self,
        query: str,
        *,
        max_results: int,
        verify_sources: bool,
        include_snippets: bool,
    ) -> list[dict[str, Any]]:
        url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
        async with httpx.AsyncClient(
            timeout=10.0,
            follow_redirects=True,
            headers={"User-Agent": "Intmatrix/1.0 (+https://www.intmatrix.com)"},
        ) as client:
            response = await client.get(url)
            response.raise_for_status()
            results = self._parse_search_results(
                response.text,
                query=query,
                max_results=max_results,
                include_snippets=include_snippets,
            )
            if verify_sources and results:
                return await self._enrich_results(client, results)
            return results

    def _parse_search_results(
        self,
        html: str,
        *,
        query: str,
        max_results: int,
        include_snippets: bool,
    ) -> list[dict[str, Any]]:
        soup = BeautifulSoup(html, "html.parser")
        items: list[dict[str, Any]] = []
        for rank, result in enumerate(soup.select(".result"), start=1):
            link = result.select_one(".result__a")
            if link is None:
                continue
            href = str(link.get("href") or "").strip()
            normalized_url = self._normalize_result_url(href)
            if not normalized_url:
                continue
            snippet = ""
            if include_snippets:
                snippet_node = result.select_one(".result__snippet")
                if snippet_node is not None:
                    snippet = snippet_node.get_text(" ", strip=True)
            items.append(
                {
                    "title": link.get_text(" ", strip=True),
                    "url": normalized_url,
                    "domain": self._domain_for_url(normalized_url),
                    "query": query,
                    "rank": rank,
                    "snippet": snippet,
                    "verified": False,
                }
            )
            if len(items) >= max_results:
                break
        return items

    async def _enrich_results(
        self,
        client: httpx.AsyncClient,
        results: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        semaphore = asyncio.Semaphore(4)

        async def enrich(result: dict[str, Any]) -> dict[str, Any]:
            async with semaphore:
                url = str(result.get("url") or "").strip()
                if not url:
                    return result
                try:
                    response = await client.get(url)
                    response.raise_for_status()
                    details = self._extract_page_details(
                        response.text,
                        final_url=str(response.url),
                        status_code=response.status_code,
                        content_type=response.headers.get("content-type", ""),
                    )
                    return {
                        **result,
                        **details,
                        "verified": True,
                    }
                except Exception as exc:
                    return {
                        **result,
                        "verified": False,
                        "error": f"{exc.__class__.__name__}: {exc}",
                    }

        return list(await asyncio.gather(*[enrich(item) for item in results]))

    async def _extract_rows_from_urls(self, urls: list[str]) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(
            timeout=10.0,
            follow_redirects=True,
            headers={"User-Agent": "Intmatrix/1.0 (+https://www.intmatrix.com)"},
        ) as client:
            semaphore = asyncio.Semaphore(4)

            async def fetch(url: str) -> dict[str, Any]:
                async with semaphore:
                    try:
                        response = await client.get(url)
                        response.raise_for_status()
                        details = self._extract_page_details(
                            response.text,
                            final_url=str(response.url),
                            status_code=response.status_code,
                            content_type=response.headers.get("content-type", ""),
                        )
                        return self._structured_row_from_result(
                            {
                                "url": url,
                                **details,
                                "verified": True,
                            }
                        )
                    except Exception as exc:
                        return {
                            "url": url,
                            "final_url": url,
                            "domain": self._domain_for_url(url),
                            "title": "",
                            "description": "",
                            "headings": "",
                            "text_excerpt": "",
                            "status_code": None,
                            "content_type": "",
                            "verified": False,
                            "error": f"{exc.__class__.__name__}: {exc}",
                        }

            return list(await asyncio.gather(*[fetch(url) for url in urls]))

    def _extract_page_details(
        self,
        html: str,
        *,
        final_url: str,
        status_code: int,
        content_type: str,
    ) -> dict[str, Any]:
        soup = BeautifulSoup(html, "html.parser")
        for node in soup(["script", "style", "noscript"]):
            node.decompose()

        title = soup.title.get_text(" ", strip=True) if soup.title else ""
        description = ""
        description_node = soup.find("meta", attrs={"name": "description"}) or soup.find(
            "meta",
            attrs={"property": "og:description"},
        )
        if description_node is not None:
            description = str(description_node.get("content") or "").strip()

        headings = [
            node.get_text(" ", strip=True)
            for node in soup.select("h1, h2, h3")[:6]
            if node.get_text(" ", strip=True)
        ]

        text_excerpt = self._snippet_from_soup(soup)
        return {
            "final_url": final_url,
            "domain": self._domain_for_url(final_url),
            "page_title": title,
            "description": description,
            "headings": headings,
            "text_excerpt": text_excerpt,
            "status_code": status_code,
            "content_type": content_type,
        }

    def _structured_row_from_result(self, result: dict[str, Any]) -> dict[str, Any]:
        headings_value = result.get("headings")
        if isinstance(headings_value, list):
            headings = " | ".join(str(item).strip() for item in headings_value if str(item).strip())
        else:
            headings = str(headings_value or "").strip()

        return {
            "citation_id": result.get("citation_id"),
            "query": result.get("query"),
            "title": str(result.get("page_title") or result.get("title") or "").strip(),
            "url": str(result.get("url") or "").strip(),
            "final_url": str(result.get("final_url") or result.get("url") or "").strip(),
            "domain": str(result.get("domain") or self._domain_for_url(str(result.get("url") or ""))).strip(),
            "description": str(result.get("description") or "").strip(),
            "snippet": str(result.get("snippet") or "").strip(),
            "headings": headings,
            "text_excerpt": str(result.get("text_excerpt") or "").strip(),
            "status_code": result.get("status_code"),
            "content_type": str(result.get("content_type") or "").strip(),
            "verified": bool(result.get("verified")),
            "error": str(result.get("error") or "").strip(),
        }

    def _save_structured_artifacts(
        self,
        title: str,
        rows: list[dict[str, Any]],
        *,
        export_format: str,
    ) -> list[dict[str, Any]]:
        formats = self._normalize_export_formats(export_format)
        artifacts: list[dict[str, Any]] = []
        safe_title = slugify(title or "web-research")

        if "json" in formats:
            json_key = f"research/{safe_title}.json"
            artifacts.append(
                {
                    "storage_key": json_key,
                    "path": self.storage.save_text(
                        json_key,
                        json.dumps(rows, indent=2, ensure_ascii=False),
                    ),
                    "content_type": "application/json",
                }
            )

        if "csv" in formats:
            headers = sorted({key for row in rows for key in row.keys()}) if rows else []
            csv_buffer = StringIO()
            writer = csv.DictWriter(csv_buffer, fieldnames=headers)
            writer.writeheader()
            writer.writerows(rows)
            csv_key = f"research/{safe_title}.csv"
            artifacts.append(
                {
                    "storage_key": csv_key,
                    "path": self.storage.save_text(csv_key, csv_buffer.getvalue()),
                    "content_type": "text/csv",
                }
            )

        return artifacts

    def _normalize_export_formats(self, export_format: str) -> tuple[str, ...]:
        lowered = str(export_format or "json").strip().lower()
        if lowered in {"both", "json+csv", "csv+json"}:
            return ("json", "csv")
        if lowered in {"csv", "json"}:
            return (lowered,)
        return ("json",)

    def _dedupe_results(self, results: Any) -> list[dict[str, Any]]:
        deduped: dict[str, dict[str, Any]] = {}
        for item in results:
            if not isinstance(item, dict):
                continue
            identity = (item.get("final_url") or item.get("url") or item.get("title") or "").strip().lower()
            if not identity:
                continue
            existing = deduped.get(identity)
            if existing is None:
                deduped[identity] = dict(item)
                continue

            merged_queries = [
                query
                for query in [existing.get("query"), item.get("query")]
                if isinstance(query, str) and query.strip()
            ]
            merged = {
                **existing,
                **item,
                "query": merged_queries[0] if len(merged_queries) == 1 else None,
                "queries": sorted({query for query in merged_queries}),
                "verified": bool(existing.get("verified")) or bool(item.get("verified")),
                "snippet": existing.get("snippet") or item.get("snippet") or "",
                "description": existing.get("description") or item.get("description") or "",
                "text_excerpt": existing.get("text_excerpt") or item.get("text_excerpt") or "",
                "headings": existing.get("headings") or item.get("headings") or [],
            }
            deduped[identity] = merged

        return list(deduped.values())

    def _assign_citations(self, results: list[dict[str, Any]]) -> list[dict[str, Any]]:
        citations: list[dict[str, Any]] = []
        for index, item in enumerate(results, start=1):
            citation_id = f"S{index}"
            item["citation_id"] = citation_id
            citations.append(
                {
                    "id": citation_id,
                    "title": item.get("page_title") or item.get("title") or f"Source {index}",
                    "url": item.get("final_url") or item.get("url") or "",
                    "verified": bool(item.get("verified")),
                    "status_code": item.get("status_code"),
                    "excerpt": item.get("text_excerpt") or item.get("snippet") or "",
                }
            )
        return citations

    def _clean_urls(self, urls: list[str]) -> list[str]:
        cleaned: list[str] = []
        seen: set[str] = set()
        for raw_url in urls:
            url = str(raw_url or "").strip()
            if not url:
                continue
            if not url.startswith(("http://", "https://")):
                url = f"https://{url}"
            identity = url.lower()
            if identity in seen:
                continue
            seen.add(identity)
            cleaned.append(url)
        return cleaned

    def _normalize_result_url(self, href: str) -> str:
        if not href:
            return ""
        normalized = href.strip()
        if normalized.startswith("//"):
            normalized = f"https:{normalized}"
        parsed = urlparse(normalized)
        if "duckduckgo.com" in parsed.netloc:
            target = parse_qs(parsed.query).get("uddg", [None])[0]
            if target:
                return unquote(target)
        return normalized

    def _domain_for_url(self, url: str) -> str:
        try:
            return urlparse(url).netloc.lower()
        except Exception:
            return ""

    def _snippet_from_soup(self, soup: BeautifulSoup, limit: int = 320) -> str:
        for selector in ("main", "article", "body"):
            node = soup.select_one(selector)
            if node is None:
                continue
            text = " ".join(part.strip() for part in node.stripped_strings if part.strip())
            if text:
                return text[:limit] + ("..." if len(text) > limit else "")
        return ""
