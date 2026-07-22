# Phase 2 文档导入核心闭环实施计划

> 状态：执行中
> 分支：`codex/phase2-document-ingestion`  
> 范围：把文件从浏览器可靠地送入隔离存储，经异步 Worker 安全检查、解析、规范化和结构化分块，再将结果发布为可用文档并在前端展示进度。

## 执行进度

- [x] 任务 1：共享合同与 Prisma 业务模型
- [x] 任务 2：MinIO 隔离存储与配置
- [x] 任务 3：文档导入 API 与事务 Outbox
- [x] 任务 4：Python Worker 持久事件骨架
- [x] 任务 5：安全门、规范化模型与结构化分块
- [x] 任务 6：结果消费、原子发布与恢复
- [x] 任务 7：React 文档与导入体验
- [x] 任务 8：端到端验收与运维说明

## 1. 目标与边界

本计划交付第一个真实可用的文档导入闭环：

1. 用户在知识空间内选择最多 100 个文件；NestJS 创建文档、版本和导入任务。
2. 浏览器逐文件以原始二进制 `PUT` 上传，显示真实上传进度并支持单文件重试。
3. NestJS 将文件流式写入 MinIO 隔离区，同时计算 SHA-256；文件不进入 Node 内存缓冲区。
4. 上传完成与业务记录在 PostgreSQL 事务内提交，并通过现有 Outbox 投递解析命令。
5. Python Worker 消费命令，执行病毒扫描、格式验证、解析、规范化和结构化分块。
6. Python 把永久结果写入 `rag` schema，并通过 Worker Outbox 发出完成或失败事件。
7. NestJS 幂等消费结果，只在新版本完全成功后切换 `Document.activeVersionId` 和 `ACTIVE` 状态。
8. React 页面展示文档、版本、任务阶段、进度和失败原因。

本计划首批验证 PDF、DOCX、XLSX、PPTX、TXT、MD、CSV、JSON。DOC、XLS、PPT 的 LibreOffice 隔离转换、扫描 PDF/Office 关键图片 OCR、安全 URL 抓取、30 天软删除与物理清理在紧随其后的 Phase 2B 计划完成；数据模型和事件协议从本计划开始即为这些能力预留稳定字段，避免返工。

本计划不实现问答、向量检索、Elasticsearch、Neo4j 或 Agent 路由；但分块结果会包含后续索引需要的稳定 ID、位置、版本、邻接关系和 ACL 快照。

## 2. 已确认的设计决策

### 2.1 服务职责

- `apps/api`：身份、权限、知识空间、文档稳定身份、版本、导入任务、上传入口、发布切换和查询 API。
- PostgreSQL `app` schema：业务状态的唯一真相；Redis 丢失不能造成业务数据丢失。
- MinIO：`quarantine/` 隔离对象与 `documents/sha256/...` 内容寻址对象。
- Redis Stream `atlas:events`：命令和结果通知；现有 `OutboxEvent`/`ProcessedEvent` 保证投递与消费幂等。
- `services/ai`：安全扫描、格式识别、解析、规范化、分块；仅写 `rag` schema，不直接修改 Prisma 管理的 `app` schema。

### 2.2 上传协议

- `POST /spaces/:spaceId/imports/files` 接收 1–100 个文件元数据，返回每个文件的 `documentId`、`versionId`、`importId` 和上传地址。
- `PUT /imports/:importId/content` 接收单个原始文件流，要求 `Content-Length`、`Content-Type` 和原始文件名请求头。
- Office/PDF 上限 200 MB；TXT/MD/CSV/JSON 上限 100 MB；服务端同时校验声明长度和实际读取字节数。
- 批量只是多个独立上传任务的编排，不使用 multipart，也不引入 `openapi-fetch`、`openapi-typescript` 或 Axios。

### 2.3 解析与安全组件

- 使用 Docling 作为 PDF、DOCX、XLSX、PPTX、MD、CSV 的统一结构解析核心；关闭远程服务和外部插件，配置文档超时及队列上限。
- TXT 使用显式编码探测与字符上限适配器；JSON 使用流式/限深校验并保留 JSON Pointer 路径。
- 使用 ClamAV `clamd` 的 INSTREAM 协议扫描隔离对象，扫描成功前不解析、不发布。
- 使用文件签名与 ZIP 容器条目检查验证真实格式，限制压缩展开总量、条目数、路径穿越和压缩比。
- Phase 2B 使用固定版本 LibreOffice 容器转换 DOC/XLS/PPT，并加入 OCR 与 URL 抓取；不在应用进程内执行不可信宏或外部插件。

### 2.4 发布语义

- `Document` 是稳定身份；每次导入产生不可变 `DocumentVersion`。
- `Document.activeVersionId` 指向当前在线版本。新版本处理期间旧版本仍然可用。
- Worker 成功事件到达后，NestJS 在一个事务内标记版本 `READY`、任务 `SUCCEEDED`、切换 active version，并把文档设为 `ACTIVE`。
- 失败只影响候选版本，不下线旧版本。

## 3. 稳定状态与事件协议

### 3.1 Prisma 状态

`DocumentProcessingStatus`：

`PENDING_UPLOAD | QUEUED | SECURITY_CHECK | PARSING | NORMALIZING | CHUNKING | READY | FAILED | CANCELLED`

`ImportTaskStatus`：

`PENDING_UPLOAD | QUEUED | RUNNING | SUCCEEDED | FAILED | CANCELLED`

`DocumentSourceType`：

`FILE | URL`

### 3.2 事件

- 命令类型：`document.ingestion.requested.v1`
- 成功类型：`document.ingestion.completed.v1`
- 失败类型：`document.ingestion.failed.v1`
- 进度类型：`document.ingestion.progressed.v1`

所有事件沿用 `apps/api/src/outbox/outbox.types.ts` 的信封；`resourceId` 是 `versionId`，`resourceVersion` 固定为事件 schema 版本 `1`，`taskId` 是 `importId`，payload 必含 `documentId`、`spaceId`、`versionId`、`objectKey`、`contentHash`、`declaredMimeType`、`originalFileName` 和 `actorId`。

## 4. 实施任务

### 任务 1：共享合同与 Prisma 业务模型

**修改文件**

- `packages/contracts/src/document-import.ts`
- `packages/contracts/src/index.ts`
- `packages/contracts/test/document-import.spec.ts`
- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260721_phase2_document_ingestion/migration.sql`

**实现**

1. 在共享包用 Zod 定义文件元数据、批量创建响应、上传完成响应、文档/版本/任务 DTO，以及四类事件 payload；单批数组 `.min(1).max(100)`。
2. 扩展 `Document`：增加 `sourceType`、`activeVersionId`、`deletedAt`、`createdById`，并保留现有 `availability`。
3. 新增 `DocumentVersion`：版本号、源类型、文件名、扩展名、声明/检测 MIME、字节数、SHA-256、对象引用、处理状态、错误码/消息、解析策略版本、创建者和发布时间；唯一约束 `(documentId, versionNumber)`。
4. 新增 `StoredObject`：SHA-256 唯一、bucket、objectKey、bytes、detectedMimeType、refCount；对象 key 不暴露用户文件名。
5. 新增 `ImportTask`：任务状态、stage、progress、quarantineObjectKey、requestId、traceId、attempt、错误和时间戳；唯一关联一个版本。
6. 使用命名 relation 解决 `Document.activeVersionId` 与 versions 的循环关系；删除采用 `Restrict/SetNull`，不级联删除共享对象。
7. 迁移现有 Document：默认 `sourceType=FILE`，已有记录保持 `activeVersionId=NULL`，由后续修复任务处理。

**验证**

```powershell
pnpm.cmd --filter @rag/contracts test
pnpm.cmd --filter @rag/contracts typecheck
pnpm.cmd --filter @rag/api prisma:generate
pnpm.cmd --filter @rag/api typecheck
```

### 任务 2：MinIO 隔离存储与配置

**修改文件**

- `apps/api/package.json`
- `pnpm-lock.yaml`
- `apps/api/src/infrastructure/config/environment.ts`
- `apps/api/src/infrastructure/config/environment.spec.ts`
- `apps/api/src/infrastructure/object-storage/object-storage.module.ts`
- `apps/api/src/infrastructure/object-storage/object-storage.service.ts`
- `apps/api/src/infrastructure/object-storage/object-storage.service.spec.ts`
- `.env.example`
- `infra/compose/compose.yaml`

**实现**

1. 引入官方 `minio` Node SDK，并封装为 `ObjectStorageService`，业务模块不得直接依赖 SDK。
2. 配置 endpoint、port、SSL、access key、secret key、quarantine bucket 和 document bucket；启动时验证 bucket 存在。
3. `putQuarantineObject(importId, stream, expectedBytes)` 使用 Transform 统计字节并计算 SHA-256，超限立即销毁流并删除不完整对象。
4. 提供 `openObject`、`promoteByHash`、`deleteObject`；`promoteByHash` 复制到 `documents/sha256/{hash[0:2]}/{hash}`，存在时复用。
5. 单元测试用 SDK adapter mock 覆盖成功、声明长度不一致、中途超限、复制复用和失败清理。

**验证**

```powershell
pnpm.cmd --filter @rag/api test -- object-storage
pnpm.cmd --filter @rag/api typecheck
docker compose -f infra/compose/compose.yaml config
```

### 任务 3：文档导入 API 与事务 Outbox

**新增/修改文件**

- `apps/api/src/documents/documents.module.ts`
- `apps/api/src/documents/documents.controller.ts`
- `apps/api/src/documents/documents.service.ts`
- `apps/api/src/documents/document-import.controller.ts`
- `apps/api/src/documents/document-import.service.ts`
- `apps/api/src/documents/document-import.validation.ts`
- `apps/api/src/documents/document-import.service.spec.ts`
- `apps/api/src/app.module.ts`
- `apps/api/src/main.ts`

**实现**

1. 创建批量任务前通过 `SpacePermissionGuard` 要求空间写权限；校验扩展名、文件数量、文件大小和重名策略。
2. 每个元数据在同一 Prisma 事务内创建 Document、version 1 和 `PENDING_UPLOAD` ImportTask；若为现有文档新版本，则锁定文档并分配递增版本号。
3. 上传入口校验任务所有者/空间权限、状态、Content-Length 和 Content-Type，向对象存储流式写入。
4. 上传成功后在一个事务内记录 hash、bytes、隔离 key，设置任务/version 为 `QUEUED`，并调用现有 `OutboxService.enqueue()` 写入 `document.ingestion.requested.v1`。
5. 上传失败保持可重试状态并记录稳定错误码；相同 importId 的重复 PUT 仅在 `PENDING_UPLOAD`/可重试失败状态接受。
6. 提供列表、详情、版本、任务状态和取消 API；取消只对未发布候选版本生效。
7. Nest bootstrap 设置请求体策略，使 JSON 元数据有小上限，原始上传路由不会被 JSON parser 预读。

**验证**

```powershell
pnpm.cmd --filter @rag/api test -- document-import
pnpm.cmd --filter @rag/api typecheck
pnpm.cmd --filter @rag/api build
```

### 任务 4：Python Worker 持久事件骨架

**新增/修改文件**

- `services/ai/pyproject.toml`
- `services/ai/uv.lock`
- `services/ai/src/rag_ai/settings.py`
- `services/ai/src/rag_ai/infrastructure/redis/stream_worker.py`
- `services/ai/src/rag_ai/infrastructure/storage/minio_storage.py`
- `services/ai/src/rag_ai/ingestion/models.py`
- `services/ai/src/rag_ai/ingestion/repository.py`
- `services/ai/src/rag_ai/ingestion/worker.py`
- `services/ai/src/rag_ai/worker_main.py`
- `services/ai/migrations/versions/20260721_02_ingestion_foundation.py`
- `services/ai/tests/test_ingestion_worker.py`
- `services/ai/tests/test_ingestion_repository.py`
- `infra/compose/compose.yaml`

**实现**

1. 增加 Redis、MinIO 和 SQLAlchemy async 依赖；Web API 与 Worker 使用不同启动命令。Docling 与安全解析依赖在任务 5 随实际适配器一并加入。
2. 在 `rag` schema 新增 `ingestion_runs`、`normalized_documents`、`normalized_elements`、`chunks`、`worker_outbox`、`processed_events`。
3. Worker 使用 consumer group 消费 `atlas:events`，只处理 `document.ingestion.requested.v1`；先写 `processed_events` 并以 eventId 保证幂等。
4. 每个阶段提交 `ingestion_runs` 状态；成功/失败/进度先写 PostgreSQL `worker_outbox`，独立 publisher 重试发布，收到 Redis ACK 后标记 published。
5. 捕获异常并映射稳定错误码，不把堆栈或文件正文放进跨服务事件。
6. Compose 增加 `ai-worker`，与 `ai` 共用镜像但启动 `python -m rag_ai.worker_main`。

**验证**

```powershell
uv run --project services/ai alembic -c services/ai/alembic.ini upgrade head
uv run --project services/ai pytest services/ai/tests/test_ingestion_repository.py services/ai/tests/test_ingestion_worker.py
uv run --project services/ai ruff check services/ai
uv run --project services/ai mypy services/ai/src
```

### 任务 5：安全门、规范化模型与结构化分块

**新增/修改文件**

- `services/ai/src/rag_ai/ingestion/security/clamav.py`
- `services/ai/src/rag_ai/ingestion/security/file_validation.py`
- `services/ai/src/rag_ai/ingestion/parsers/base.py`
- `services/ai/src/rag_ai/ingestion/parsers/docling_parser.py`
- `services/ai/src/rag_ai/ingestion/parsers/text_parser.py`
- `services/ai/src/rag_ai/ingestion/parsers/json_parser.py`
- `services/ai/src/rag_ai/ingestion/normalization/models.py`
- `services/ai/src/rag_ai/ingestion/normalization/normalizer.py`
- `services/ai/src/rag_ai/ingestion/chunking/structure_chunker.py`
- `services/ai/tests/fixtures/ingestion/`
- `services/ai/tests/test_file_validation.py`
- `services/ai/tests/test_parsers.py`
- `services/ai/tests/test_structure_chunker.py`
- `infra/compose/compose.yaml`

**实现**

1. Compose 加入官方固定版本 ClamAV 服务和健康检查；Worker 仅在 clamd 就绪后处理。
2. 以流方式扫描对象；检测病毒、格式伪装、ZIP 路径穿越、超大解压体积、过多条目、异常压缩比和 PDF 页数上限。
3. Docling adapter 输出统一元素：heading、paragraph、list_item、table、image_caption、sheet_region、slide_note；保留 page/slide/sheet/cell range/bounding box。
4. TXT 适配器拒绝二进制内容并规范换行；JSON 限制最大深度、节点数和字符串长度，输出 JSON Pointer 位置。
5. 结构分块优先按标题、段落、表格、页/幻灯片/工作表边界；超长元素再按 token 长度切分。每个 chunk 保存 `parentChunkId`、`previousChunkId`、`nextChunkId`、location JSON、contentHash、versionId、spaceId 和 ACL snapshot。
6. fixture 至少覆盖每种首批格式的中英文正常文件、损坏文件和超限模拟；大文件使用生成器/stream stub，仓库不提交巨型二进制。

**验证**

```powershell
uv run --project services/ai pytest services/ai/tests/test_file_validation.py services/ai/tests/test_parsers.py services/ai/tests/test_structure_chunker.py
docker compose -f infra/compose/compose.yaml up -d clamav minio redis postgres
docker compose -f infra/compose/compose.yaml ps
```

### 任务 6：结果消费、原子发布与恢复

**新增/修改文件**

- `apps/api/src/documents/document-ingestion.consumer.ts`
- `apps/api/src/documents/document-ingestion.consumer.spec.ts`
- `apps/api/src/documents/document-publication.service.ts`
- `apps/api/src/documents/document-publication.service.spec.ts`
- `apps/api/src/documents/document-reconciliation.service.ts`
- `apps/api/src/documents/document-reconciliation.service.spec.ts`

**实现**

1. 使用现有 `StreamConsumer` 分 consumer group 消费 Worker 的 progressed/completed/failed 事件。
2. progress 仅单调前进；过期版本和重复 eventId 不回滚状态。
3. completed 事务中校验 document/version/task 关系，复用或创建 `StoredObject`、增加 refCount、切换 activeVersionId、标记 version `READY`、task `SUCCEEDED`、document `ACTIVE`，再删除 quarantine object。
4. failed 事务只标记候选版本和任务；若文档无 active version，则保持 `DRAFT`，否则保持 `ACTIVE`。
5. reconciliation 周期任务扫描超过阈值的 QUEUED/RUNNING 任务，对照 Outbox、rag ingestion run 和对象存在性重发或失败收敛；永久状态不依赖 Redis TTL。

**验证**

```powershell
pnpm.cmd --filter @rag/api test -- document-ingestion document-publication document-reconciliation
pnpm.cmd --filter @rag/api typecheck
```

### 任务 7：React 文档与导入体验

**新增/修改文件**

- `apps/web/src/features/documents/document-contract.ts`
- `apps/web/src/features/documents/documents-api.ts`
- `apps/web/src/features/documents/use-documents-query.ts`
- `apps/web/src/features/documents/document-list-page.tsx`
- `apps/web/src/features/documents/document-upload-panel.tsx`
- `apps/web/src/features/documents/document-upload-store.ts`
- `apps/web/src/features/documents/document-upload-panel.spec.tsx`
- `apps/web/src/app/app-router.tsx`
- `apps/web/src/styles.css`

**实现**

1. 使用现有 `request-json` 完成元数据和查询请求；上传使用浏览器 `XMLHttpRequest`，因为 Fetch 尚不能稳定提供上传进度。
2. 选择文件时即时校验格式、数量和大小；并发上传数固定为 3，失败文件可单独重试或取消。
3. 列表显示标题、版本、可用状态、处理阶段、进度、更新时间和稳定错误提示；运行中任务每 2 秒轮询，终态停止。
4. 路由增加 `/spaces/:spaceId/documents`，未选择空间时回到空间选择页。
5. 测试覆盖 100 文件限制、前端大小限制、并发上限、上传进度、失败重试和终态停止轮询。

**验证**

```powershell
pnpm.cmd --filter @rag/web test -- document-upload-panel
pnpm.cmd --filter @rag/web typecheck
pnpm.cmd --filter @rag/web build
```

### 任务 8：端到端验收与运维说明

**新增/修改文件**

- `apps/api/test/document-import.e2e-spec.ts`
- `services/ai/tests/integration/test_ingestion_pipeline.py`
- `docs/development/document-ingestion.md`
- `README.md`
- `.github/workflows/ci.yml`

**实现**

1. API e2e 覆盖创建任务、流式上传、权限拒绝、超限、重复 PUT、Outbox 事件和查询状态。
2. 集成测试使用小型真实 fixture 跑通 MinIO → Worker → rag schema → result event → Nest 发布。
3. 验证新版本失败时旧 activeVersionId 不变；无 active version 的文档失败后不可被问答授权读取。
4. 文档记录依赖服务、环境变量、任务状态、错误码、重试/恢复方法、对象目录和本地排障命令。
5. CI 增加 contracts/API/Web/Python 静态检查；完整解析集成测试放入 infrastructure job，避免每个小任务重复执行重型测试。

**最终验证**

```powershell
pnpm.cmd lint
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd build
uv run --project services/ai pytest
uv run --project services/ai ruff check services/ai
uv run --project services/ai mypy services/ai/src
docker compose -f infra/compose/compose.yaml config
docker compose -f infra/compose/compose.yaml up -d
docker compose -f infra/compose/compose.yaml ps
```

## 5. Phase 2B 紧随计划

本闭环合并后立即编写并执行 `document-ingestion-hardening` 计划，覆盖：

- DOC/XLS/PPT 经隔离 LibreOffice 转换，转换进程超时、CPU/内存和临时目录限制。
- 扫描 PDF OCR、Office 关键图片 OCR、OCR 语言和策略版本记录。
- HTTP/HTTPS URL 单页导入：每次 DNS 解析和每个 redirect hop 校验 A/AAAA，拒绝 loopback、link-local、private、metadata 地址；禁止自动重定向，最多 5 次，正文最大 20 MB，无递归爬取。
- 内容正文抽取、页面标题/来源/抓取时间/最终 URL 保存。
- 相同空间 hash 去重、跨空间 blob 引用计数、版本刷新、30 天软删除、恢复重建与物理清理。
- Elasticsearch BM25 与 pgvector 的原子索引发布；关闭 embedding 的空间允许 BM25-only 发布。
- 全格式正常/损坏/超限/中英文 fixture 矩阵，以及故障恢复和资源压测。

## 6. 自审清单

- [x] 不引入用户已拒绝的 OpenAPI 代码生成依赖。
- [x] Node 上传全程流式，不把 200 MB 文件读入内存。
- [x] PostgreSQL 保存永久任务状态，Redis 只承担可重放消息传递。
- [x] Python 不直接写 Prisma 管理的 `app` schema。
- [x] 新版本成功前不替换旧在线版本。
- [x] 隔离对象在病毒扫描和格式验证前不可发布。
- [x] 结构和位置字段可服务后续引用溯源、混合检索与知识图谱。
- [x] 重型解析测试集中在批次/CI 基础设施任务，不要求每个小改动都做完整 TDD。
- [x] Phase 2A 与 Phase 2B 边界明确，Phase 2B 仍覆盖原 PRD 的所有 P0 格式和安全要求。
