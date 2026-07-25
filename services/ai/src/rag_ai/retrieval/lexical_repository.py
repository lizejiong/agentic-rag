from __future__ import annotations

from uuid import UUID

from elasticsearch import AsyncElasticsearch

from rag_ai.retrieval.models import AclSnapshot, CitationLocation, RetrievedChunk


class LexicalRepository:
    def __init__(self, client: AsyncElasticsearch, index: str) -> None:
        self._client = client
        self._index = index

    async def ensure_index(self) -> None:
        """Idempotent index creation with a BM25-friendly mapping."""
        exists = await self._client.indices.exists(index=self._index)
        if exists:
            return
        await self._client.indices.create(
            index=self._index,
            body={
                "settings": {
                    "number_of_shards": 1,
                    "number_of_replicas": 0,
                    "analysis": {
                        "analyzer": {
                            "default": {
                                "type": "custom",
                                "tokenizer": "standard",
                                "filter": ["lowercase", "asciifolding"],
                            }
                        }
                    },
                },
                "mappings": {
                    "properties": {
                        "chunk_id": {"type": "keyword"},
                        "document_id": {"type": "keyword"},
                        "version_id": {"type": "keyword"},
                        "space_id": {"type": "keyword"},
                        "content": {"type": "text", "analyzer": "default"},
                        "title": {"type": "text", "analyzer": "default"},
                        "is_searchable": {"type": "boolean"},
                        "location": {"type": "object", "enabled": False},
                        "acl_snapshot": {"type": "object", "enabled": False},
                    }
                },
            },
        )

    async def index_chunk(self, chunk: RetrievedChunk) -> None:
        await self._client.index(
            index=self._index,
            id=str(chunk.chunk_id),
            document={
                "chunk_id": str(chunk.chunk_id),
                "document_id": str(chunk.document_id),
                "version_id": str(chunk.version_id),
                "space_id": str(chunk.space_id),
                "content": chunk.content,
                "title": chunk.title,
                "is_searchable": True,
                "location": {
                    "page": chunk.location.page,
                    "slide": chunk.location.slide,
                    "sheet": chunk.location.sheet,
                    "cellRange": chunk.location.cell_range,
                },
                "acl_snapshot": chunk.metadata.get("acl_snapshot", {}),
            },
        )

    async def set_searchable(self, chunk_id: UUID, searchable: bool) -> None:
        try:
            await self._client.update(
                index=self._index,
                id=str(chunk_id),
                doc={"is_searchable": searchable},
            )
        except Exception:
            # Document may not exist; deletion/soft-deletion is best-effort here.
            pass

    async def search(
        self,
        query: str,
        space_ids: list[UUID],
        acl: AclSnapshot,
        *,
        top_k: int,
    ) -> list[RetrievedChunk]:
        if not space_ids:
            return []

        allowed_space_ids = [space_id for space_id in space_ids if acl.can_view_space(space_id)]
        if not allowed_space_ids:
            return []

        response = await self._client.search(
            index=self._index,
            body={
                "size": top_k * 4,
                "query": {
                    "bool": {
                        "must": [
                            {
                                "multi_match": {
                                    "query": query,
                                    "fields": ["content^3", "title^2"],
                                    "type": "best_fields",
                                }
                            }
                        ],
                        "filter": [
                            {"terms": {"space_id": [str(space_id) for space_id in allowed_space_ids]}},
                            {"term": {"is_searchable": True}},
                        ],
                    }
                },
            },
        )

        candidates: list[RetrievedChunk] = []
        for hit in response["hits"]["hits"]:
            source = hit["_source"]
            acl_snapshot = source.get("acl_snapshot", {})
            space_id = UUID(source["space_id"])
            if not acl.can_read_document(space_id, acl_snapshot):
                continue
            location = source.get("location", {})
            candidates.append(
                RetrievedChunk(
                    chunk_id=UUID(source["chunk_id"]),
                    document_id=UUID(source["document_id"]),
                    version_id=UUID(source["version_id"]),
                    space_id=space_id,
                    content=source["content"],
                    title=source["title"],
                    location=CitationLocation(
                        page=location.get("page"),
                        slide=location.get("slide"),
                        sheet=location.get("sheet"),
                        cell_range=location.get("cellRange"),
                    ),
                    score=float(hit["_score"]),
                    path="lexical",
                )
            )
            if len(candidates) >= top_k:
                break
        return candidates
