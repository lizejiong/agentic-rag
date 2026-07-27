# 计划 3：混合检索与可验证问答

> 执行要求：`superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，使用 checkbox 逐项跟踪。在独立 `codex/phase3-hybrid-retrieval` worktree 中执行。

**前置：** 计划 0/1/2 已通过出口检查；文档版本、块、ACL snapshot 和事件总线已稳定。

**目标：** 实现 pgvector + Elasticsearch BM25 双路召回、RRF 融合、Reranker 精排、ACL 过滤、简单 LangGraph Agent、句级引用、检索摘要和短期记忆，使问答从“假流”升级为带证据的真实 RAG。

---

## 1. 设计决策

### 1.1 索引边界

- `rag.chunks` 已保存可检索文本、位置、ACL snapshot、父子/邻接关系。
- 新增 `rag.chunk_embeddings` 表，按 `(chunk_id, embedding_model, embedding_version)` 唯一，支持未来索引代次切换。
- Elasticsearch 索引 `atlas_chunks` 保存 BM25 文本、元数据和在线状态；删除/撤权时通过 `is_searchable` 软标记并异步清理。
- 平台级 Embedding 配置决定维度（默认 384，与 `all-MiniLM-L6-v2` 兼容）和距离度量（默认 cosine）。

### 1.2 模型适配层

- 新增 `rag_ai.models` 包，统一接口：`EmbeddingModel.embed(texts)`, `Reranker.rerank(query, candidates)`, `ChatModel.achat(messages)`。
- 默认提供 `MockEmbeddingModel`（确定性 hash→float 向量）和 `MockReranker`、`MockChatModel`，保证无云凭证时测试和本地开发可通过。
- 环境变量可选启用真实模型：
  - `EMBEDDING_PROVIDER=local|openai|...`
  - `RERANKER_PROVIDER=none|local|cohere|...`
  - `LLM_PROVIDER=none|openai|...`
- 未启用 LLM 时，Agent 降级为返回排序后的检索摘要 + 原文片段，不伪造答案。

### 1.3 检索流程

1. 从请求解析 `selectedSpaceIds` 和 ACL snapshot（由 NestJS 在 `RunRequest` 中传入）。
2. 对允许 Embedding 的空间执行 pgvector 语义召回 Top 50；禁用空间跳过并记录路径。
3. 对所有空间执行 Elasticsearch BM25 召回 Top 50。
4. 召回阶段用 PostgreSQL 主键过滤 ACL snapshot（空间 VIEW + 文档 ACL 允许列表）。
5. RRF `k=60` 合并为 Top 30。
6. Reranker 输出 Top 10；Reranker 禁用时直接取 RRF Top 10。
7. 上下文扩展：标题、父块、邻接块（可选，默认开启）。
8. 证据充分性判断：基于 Top10 与查询的相关性分布；不足时一次查询重写并重试，仍不足则返回 `INSUFFICIENT_EVIDENCE`。
9. LLM 生成答案，按句附加 `citation_id`；LLM 禁用时返回检索摘要和片段。

### 1.4 Agent 状态图

LangGraph 状态：

```text
start -> load_memory -> understand_query -> decide_route -> retrieve -> merge_evidence -> rerank -> assess -> (answer|clarify|fallback) -> end
```

约束：

- 最多一次自动查询重写。
- 只调用白名单只读工具（检索、记忆读取）。
- 不调用外部网络或业务写操作。
- 取消信号在每个节点检查。

### 1.5 流式事件扩展

在现有 `AgentEvent` 上新增：

- `retrieval.summary`：记录召回路径、候选数、RRF/Reranker 结果、策略版本。
- `citation` 增加可选的 `chunkId` 和 `documentId`（NestJS 侧不外传，仅用于内部引用解析）。

浏览器侧 data parts：

- `data-agent-status`
- `data-retrieval-summary`
- `data-citation`
- `data-error-detail`

### 1.6 引用重新鉴权

- NestJS 新增 `GET /citations/:citationId/resolve`。
- 根据当前登录用户、最新 ACL、文档可用状态重新鉴权；通过后返回标题、位置、片段和不超过 5 秒有效期的预览会话令牌。
- 答案生成时的 ACL snapshot 和客户端字段不能作为当前授权依据。

### 1.7 短期记忆

- Redis 保存最近 N 轮滑动窗口（默认 N=10）和轻量会话摘要。
- 以 `userId:sessionId` 为键；会话删除后同步清理。
- 摘要生成失败保留最近窗口，不阻塞问答。

---

## 2. 关键文件变更

### Python AI

- `services/ai/pyproject.toml`：添加 `pgvector`, `elasticsearch[async]`, `langgraph`, `numpy`, 可选 `sentence-transformers`。
- `services/ai/migrations/versions/20260725_04_retrieval_indexes.py`：创建 `chunk_embeddings` 和向量索引；增加 `rag.chunks.is_searchable` 及 ES 同步触发字段。
- `services/ai/src/rag_ai/models/`：模型适配层。
- `services/ai/src/rag_ai/retrieval/`：检索、RRF、rerank、ACL 过滤、上下文扩展。
- `services/ai/src/rag_ai/memory/`：Redis 短期记忆。
- `services/ai/src/rag_ai/agent/`：LangGraph 状态图与工具。
- `services/ai/src/rag_ai/contracts/agent_events.py`：扩展事件类型。
- `services/ai/src/rag_ai/routes/runs.py`：接入真实 Agent。
- `services/ai/src/rag_ai/ingestion/repository.py`：写入 embedding 和发布 ES 索引事件。
- `services/ai/src/rag_ai/settings.py`：增加模型/检索配置。

### NestJS API

- `apps/api/src/search/search.controller.ts`, `search.service.ts`：授权搜索 API。
- `apps/api/src/citations/citations.controller.ts`, `citations.service.ts`：引用解析与重新鉴权。
- `apps/api/src/chat/chat.controller.ts`：传递会话上下文。
- `apps/api/src/ai/ai-stream.mapper.ts`：映射 `retrieval.summary`。
- `apps/api/src/app.module.ts`：注册新模块。

### Contracts / Web

- `packages/contracts/src/agent-events.ts`：新增 `retrieval.summary` 事件和 `RunRequest` 字段。
- `packages/contracts/src/ui-message.ts`：新增 `retrieval-summary` data part。
- `apps/web/src/features/chat/`：展示检索摘要和引用。

---

## 3. 验收标准

- [ ] Recall@10 ≥ 0.85、nDCG@10 ≥ 0.75 在 fixture 评测集上成立（使用确定性 embedding 的语义测试集）。
- [ ] 引用准确率 ≥ 0.95（每个 citation 指向真实存在的块）。
- [x] 无 ACL 越权：禁用/撤权文档不可召回，引用解析返回无权访问。
- [x] 证据不足案例返回 `INSUFFICIENT_EVIDENCE` 状态，不编造答案。
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` 全部通过。
- [x] Python `ruff check`, `mypy`, `pytest` 全部通过（2026-07-26）。
- [x] 三进程 smoke（web/api/ai）问答链路可运行并返回真实检索结果（2026-07-26 真实模型 E2E）。

---

## 4. 实施任务清单

- [x] 1. 准备：创建 `codex/phase3-hybrid-retrieval` worktree，更新依赖。
- [x] 2. 数据层：pgvector 扩展、chunk_embeddings 表、ES 索引定义。
- [x] 3. 模型层：mock + 可选真实 Embedding/Reranker/LLM 适配器。
- [x] 4. 索引层：ingestion 成功后写入 embedding 和 ES；空间禁用 embedding 时跳过向量。
- [x] 5. 检索层：双路召回、ACL 过滤、RRF、Reranker、上下文扩展。
- [x] 6. Agent 层：LangGraph 简单状态图、证据充分性、引用生成、降级。
- [x] 7. 记忆层：Redis 滑动窗口和会话摘要。
- [x] 8. 契约层：扩展 AgentEvent 与 UI message data parts。
- [x] 9. API 层：`/search`、`/citations/:id/resolve`、聊天上下文传递。
- [x] 10. 前端层：检索摘要和引用 UI。
- [x] 11. 测试：单元、集成、契约、端到端和 smoke。
- [x] 12. 评测基础设施：实现 Recall@10、nDCG@10、引用准确率计算及 JSONL 阈值报告运行器。
- [x] 13. 社区基线：接入 BEIR SciFact，生成可复用的检索问题与 qrels 标注集。
- [ ] 14. 出口检查：将基线语料导入候选环境，运行完整验收命令并记录结果。

