# Atlas RAG

Atlas RAG 是一个面向企业知识场景的 Agentic RAG 项目。目标能力包括文档管理、混合检索、可追溯 AI 问答、知识图谱、分层记忆、语音交互与可观测性。

当前仓库已完成 **Phase 0 工程基础** 和 **Phase 1 本地数据、认证与授权基础**：

- React + Vercel AI SDK 聊天界面
- NestJS 外部 API 与 AI SDK UI Message Stream
- FastAPI 内部 AI 服务与可取消 NDJSON 事件流
- TypeScript/Python 双端严格 `AgentEvent` 契约
- 连续 sequence、单记录 64 KiB 上限、协议版本拒绝
- 浏览器断开和显式取消的跨服务传播
- 桌面/移动端 UI、自动化测试、真实三进程 smoke 与 CI
- PostgreSQL/pgvector、Elasticsearch、Neo4j、Redis、MinIO 本地数据平台
- `ADMIN` / `MEMBER` 本地账号、Argon2id 密码、JWT access token 与旋转 refresh session
- 部门、用户组、知识空间和 `VIEW` / `EDIT` / `MANAGE` 递进授权
- 文档 ACL 收紧、统一授权快照、revision 缓存失效与聊天入口强制鉴权
- 不可变审计、事务 PostgreSQL Outbox、Redis Streams 幂等消费、退避与死信
- React 内存 access token、HttpOnly cookie 会话恢复和知识空间选择

文档上传与解析、PGVector + Elasticsearch 混合检索、RRF、Reranker、Neo4j 图谱、
Redis/mem0 记忆、LangGraph Agent、语音和可观测性将在后续阶段逐步实现，详见
[总路线图](docs/superpowers/plans/2026-07-18-enterprise-rag-master-roadmap.md)。

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
- [Phase 1 依赖与目录决策](docs/architecture/003-phase1-library-and-layout-decisions.md)
- [本地快速启动](docs/development/quickstart.md)
- [完整 PRD](docs/superpowers/specs/2026-07-17-enterprise-agentic-rag-prd-design.md)

## 快速开始

```bash
corepack prepare pnpm@11.14.0 --activate
pnpm install
uv sync --project services/ai
pnpm infra:up
pnpm db:migrate:app
pnpm db:migrate:rag
pnpm db:seed
```

随后分别运行：

```bash
pnpm dev:ai
pnpm dev:api
pnpm dev:web
```

浏览器打开 `http://127.0.0.1:5173`，使用引导管理员登录。配置复制、密钥、迁移、
管理员引导和 smoke 命令见[快速启动文档](docs/development/quickstart.md)。

## 安全说明

浏览器只能访问 NestJS，不能直接访问 Python、模型或存储。聊天使用真实登录主体，
所有选定知识空间在调用 AI 前执行 PostgreSQL 真相源授权；文档搜索、引用、预览和下载
共享同一授权服务。生产部署仍需替换示例密钥、启用安全 cookie、配置 TLS，并完成后续
文档处理与检索阶段的安全验收。
