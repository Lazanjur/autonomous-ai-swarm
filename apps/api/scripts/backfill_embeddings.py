from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from uuid import UUID

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.db.session import SessionLocal
from app.services.rag.service import KnowledgeService


async def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill missing embeddings for document chunks.")
    parser.add_argument("--workspace-id", type=UUID, default=None, help="Optional workspace scope")
    parser.add_argument("--batch-size", type=int, default=32, help="Batch size per embedding request")
    parser.add_argument("--limit", type=int, default=None, help="Optional maximum number of chunks to backfill")
    args = parser.parse_args()

    service = KnowledgeService()
    async with SessionLocal() as session:
        result = await service.backfill_embeddings(
            session,
            workspace_id=args.workspace_id,
            batch_size=args.batch_size,
            limit=args.limit,
        )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
