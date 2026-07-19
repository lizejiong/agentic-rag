# Atlas RAG

Atlas RAG 是一个面向企业知识场景的 Agentic RAG 项目。目标能力包括文档管理、混合检索、可追溯 AI 问答、知识图谱、分层记忆、语音交互与可观测性。

当前仓库完成的是 **Plan 0：工程基础与流式协议**，不是完整产品：

- React + Vercel AI SDK 聊天界面
- NestJS 外部 API 与 AI SDK UI Message Stream
- FastAPI 内部 AI 服务与可取消 NDJSON 事件流
- TypeScript/Python 双端严格 `AgentEvent` 契约
- 连续 sequence、单记录 64 KiB 上限、协议版本拒绝
- 浏览器断开和显式取消的跨服务传播
- 桌面/移动端 UI、自动化测试、真实三进程 smoke 与 CI

文档上传与解析、PGVector + Elasticsearch 混合检索、RRF、Reranker、Neo4j、Redis/mem0 记忆、LangGraph Agent、语音和可观测性将在后续计划逐步实现，详见[总路线图](docs/superpowers/plans/2026-07-18-enterprise-rag-master-roadmap.md)。

## 工作区

```text
apps/web          React Web
apps/api          NestJS API / SSE 协议网关
services/ai       FastAPI AI / NDJSON 事件源
packages/contracts 共享 TypeScript 契约
```

关键设计：

- [服务边界与信任模型](docs/architecture/001-service-boundaries.md)
- [流式事件、背压与取消契约](docs/architecture/002-streaming-contract.md)
- [本地快速启动](docs/development/quickstart.md)
- [完整 PRD](docs/superpowers/specs/2026-07-17-enterprise-agentic-rag-prd-design.md)

## 快速开始

```bash
corepack prepare pnpm@11.14.0 --activate
pnpm install
uv sync --project services/ai
```

随后分别运行：

```bash
pnpm dev:ai
pnpm dev:api
pnpm dev:web
```

浏览器打开 `http://127.0.0.1:5173`。更多环境要求、端口和验证命令见[快速启动文档](docs/development/quickstart.md)。

## 安全说明

浏览器只能访问 NestJS，不能直接访问 Python、模型或存储。当前 `foundation-user` 是基础阶段占位身份；真实认证、租户隔离、检索前 ACL 和引用重新鉴权是 Plan 1 的首个阻断条件，完成前不得连接生产知识数据。
