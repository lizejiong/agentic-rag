# 本地数据平台与身份权限实施计划

> **给 agentic workers：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务逐项执行本计划。步骤使用 checkbox（`- [ ]`）语法跟踪状态。

**目标：** 在 Phase 0 流式问答骨架上交付可本地运行的数据平台、本地账号、两种系统角色、知识空间 ACL、审计和可靠异步事件基础，并用真实登录主体替换 `foundation-user`。

**架构：** 保留 `apps/web`、`apps/api`、`services/ai`、`packages/contracts` 四个顶层边界；NestJS 按业务能力组织 feature module，Prisma 只管理 PostgreSQL `app` schema，Python 使用 Alembic 只管理 `rag` schema。PostgreSQL 是授权和任务真相源，Redis 只承担缓存、限流和 Streams 传输；所有 ACL 变化在同一数据库事务中递增全局 `authorization_revision` 并写入 Outbox。

**技术栈：** pnpm workspace、NestJS 11、Prisma ORM 7、PostgreSQL/pgvector、Argon2id、JWT、Redis Streams、Python 3.12、SQLAlchemy 2、Alembic、Docker Compose、React、Vercel AI SDK UI。

---

## 0. 实施取舍与目录边界

本计划先做一次轻量架构门禁，不把 PRD 中提到的库视为不可替换。采用以下决策：

- 保留当前 monorepo。前端、业务 API、AI 服务和跨边界契约已经形成清晰的独立部署单元，没有拆仓收益。
- NestJS 使用 feature-first 目录；数据库和 Redis 连接放在 `src/infrastructure`，不能把全部业务堆入 `common`、`utils` 或单个 `services` 目录。
- 采用 Prisma，而不是自写 SQL repository、TypeORM 或 Drizzle：本阶段关系模型多、迁移和类型安全收益明显；复杂检索 SQL 在后续 RAG repository 中允许使用参数化原生 SQL，避免 ORM 绑架检索实现。
- 认证采用 NestJS guards + `@nestjs/jwt` + `argon2`，不引入完整身份平台。首期只有本地账号和两个系统角色，引入 Keycloak/Auth.js 会增加部署与同步边界。
- Redis 使用官方 `redis` Node 客户端；Streams/outbox 逻辑保持项目内薄封装，不引入 BullMQ，因为 Python 也要消费同一跨语言协议。
- Compose 仅承载中间件，应用仍可在宿主机开发运行。部署配置进入 `infra/compose`，避免根目录随服务增长而失控。
- `packages/contracts` 只放跨进程/跨前端边界的稳定契约，不共享 Prisma model、NestJS entity 或内部 service 类型。
- 参考 Dify 的“开发中间件 Compose 与应用进程分离”、RAGFlow 的“集中管理 Elasticsearch/MinIO/Redis 环境变量与健康检查”、Onyx 的“按能力拆 backend module、集中安全和 trace 规则”；不复制其历史包袱或单体目录。

目标目录：

```text
apps/api/
├── prisma/
│   ├── migrations/
│   ├── schema.prisma
│   └── seed.ts
└── src/
    ├── auth/
    ├── authorization/
    ├── audit/
    ├── organization/
    ├── spaces/
    ├── outbox/
    └── infrastructure/
        ├── config/
        ├── database/
        └── redis/
infra/compose/
├── compose.yaml
├── .env.example
└── README.md
services/ai/
├── alembic.ini
├── migrations/
└── src/rag_ai/infrastructure/database/
```

### 任务 1：记录依赖和目录决策

**文件：**
- 新建：`docs/architecture/003-phase1-library-and-layout-decisions.md`
- 修改：`README.md`

- [x] **步骤 1：写入 ADR**

ADR 必须记录每个候选项的“采用/不采用、原因、退出策略、许可证”，至少覆盖 Prisma、Argon2、JWT、Redis client、BullMQ、Keycloak、Testcontainers，以及上述目录边界。

- [x] **步骤 2：在 README 中增加架构决策入口**

在“关键设计”列表加入：

```markdown
- [Phase 1 依赖与目录决策](docs/architecture/003-phase1-library-and-layout-decisions.md)
```

- [x] **步骤 3：验证并提交**

运行：`git diff --check`

预期：无输出。

```bash
git add docs/architecture/003-phase1-library-and-layout-decisions.md README.md
git commit -m "docs: record phase one architecture decisions"
```

### 任务 2：建立本地中间件 Compose

**文件：**
- 新建：`infra/compose/compose.yaml`
- 新建：`infra/compose/.env.example`
- 新建：`infra/compose/README.md`
- 新建：`scripts/check-infrastructure.mjs`
- 修改：`package.json`
- 修改：`.gitignore`

- [x] **步骤 1：定义固定服务和持久卷**

`compose.yaml` 定义 `postgres`、`elasticsearch`、`neo4j`、`redis`、`minio`、一次性 `minio-init`。PostgreSQL 镜像必须包含 pgvector；所有长期服务必须设置 healthcheck、资源上限、命名卷和 `restart: unless-stopped`。Elasticsearch 以单节点、禁用遥测的开发模式运行，但仍设置密码。

Compose 对外端口固定为：

```text
PostgreSQL 5432
Elasticsearch 9200
Neo4j HTTP 7474 / Bolt 7687
Redis 6379
MinIO API 9000 / Console 9001
```

- [x] **步骤 2：提供无密钥默认模板**

`.env.example` 只提供开发占位值和变量说明；真实 `.env` 保持忽略。至少包含：

```dotenv
POSTGRES_DB=atlas_rag
POSTGRES_USER=atlas
POSTGRES_PASSWORD=change-me
ELASTIC_PASSWORD=change-me
NEO4J_AUTH=neo4j/change-me-now
REDIS_PASSWORD=change-me
MINIO_ROOT_USER=atlas
MINIO_ROOT_PASSWORD=change-me-now
```

- [x] **步骤 3：实现基础设施健康检查**

`scripts/check-infrastructure.mjs` 调用各服务公开健康端点/协议，失败时输出服务名和修复命令，成功时输出：

```text
Infrastructure is healthy: postgres, elasticsearch, neo4j, redis, minio
```

根脚本增加：

```json
{
  "infra:up": "docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml up -d",
  "infra:ps": "docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml ps",
  "infra:check": "node scripts/check-infrastructure.mjs"
}
```

- [x] **步骤 4：从空卷启动并验证**

运行：

```bash
docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml config
docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml up -d
pnpm infra:check
```

预期：五个长期服务均为 healthy，MinIO bucket `atlas-rag` 已创建。

- [x] **步骤 5：提交**

```bash
git add infra scripts/check-infrastructure.mjs package.json .gitignore
git commit -m "infra: add local data platform compose"
```

### 任务 3：建立 NestJS `app` schema 与迁移

**文件：**
- 新建：`apps/api/prisma/schema.prisma`
- 新建：`apps/api/prisma/migrations/*/migration.sql`
- 新建：`apps/api/prisma/seed.ts`
- 新建：`apps/api/prisma.config.ts`
- 新建：`apps/api/src/infrastructure/database/database.module.ts`
- 新建：`apps/api/src/infrastructure/database/prisma.service.ts`
- 新建：`apps/api/src/infrastructure/config/environment.ts`
- 新建：`apps/api/src/infrastructure/config/environment.spec.ts`
- 修改：`apps/api/src/app.module.ts`
- 修改：`apps/api/package.json`
- 修改：`package.json`
- 修改：`.env.example`

- [ ] **步骤 1：安装并固定 Prisma**

运行：

```bash
pnpm --filter @rag/api add @prisma/client @prisma/adapter-pg pg
pnpm --filter @rag/api add -D prisma tsx @types/pg
```

提交前确认 `pnpm-lock.yaml` 中 Prisma Client 和 CLI 为同一版本。

- [ ] **步骤 2：定义最小但可扩展的数据模型**

`schema.prisma` 使用 PostgreSQL `app` schema，并定义：

```prisma
enum SystemRole { ADMIN MEMBER }
enum UserStatus { ACTIVE DISABLED }
enum SpaceStatus { ACTIVE ARCHIVED }
enum SpacePermission { VIEW EDIT MANAGE }
enum SubjectType { USER DEPARTMENT GROUP }
enum DocumentAvailability { DRAFT ACTIVE INACTIVE SOFT_DELETED }
enum AuditResult { SUCCESS DENIED FAILED }
enum OutboxStatus { PENDING PUBLISHED FAILED }

model User {
  id                    String     @id @default(uuid()) @db.Uuid
  username              String     @unique
  displayName           String
  passwordHash          String
  role                  SystemRole @default(MEMBER)
  status                UserStatus @default(ACTIVE)
  departmentId          String?    @db.Uuid
  failedLoginCount      Int        @default(0)
  lockedUntil           DateTime?
  tokenVersion          Int        @default(0)
  createdAt             DateTime   @default(now())
  updatedAt             DateTime   @updatedAt
  @@schema("app")
}

model AuthorizationState {
  id       Int    @id @default(1)
  revision BigInt @default(0)
  @@schema("app")
}
```

同一 schema 中补齐 `Department`、`Group`、`GroupMember`、`KnowledgeSpace`、`SpaceGrant`、`Document`、`DocumentAclEntry`、`RefreshSession`、`AuditLog`、`OutboxEvent` 和 `ProcessedEvent`。`SpaceGrant` 使用 `(spaceId, subjectType, subjectId)` 唯一约束；`DocumentAclEntry` 使用 `(documentId, subjectType, subjectId)` 唯一约束；`OutboxEvent.eventId` 和 `ProcessedEvent.eventId` 都必须唯一。

- [ ] **步骤 3：实现配置的启动即失败校验**

`environment.ts` 使用 Zod 校验数据库、Redis、JWT、cookie 和服务 URL。生产环境拒绝示例密码，JWT access/refresh secret 不得相同。

- [ ] **步骤 4：生成并执行迁移**

运行：

```bash
pnpm --filter @rag/api prisma generate
pnpm --filter @rag/api prisma migrate dev --name phase1_app_schema
pnpm --filter @rag/api prisma db seed
```

预期：PostgreSQL 出现 `app` schema；`AuthorizationState` 存在且 revision 为 `0`。

- [ ] **步骤 5：运行配置和数据库测试并提交**

运行：

```bash
pnpm --filter @rag/api test -- environment.spec.ts
pnpm --filter @rag/api typecheck
```

```bash
git add apps/api package.json pnpm-lock.yaml .env.example
git commit -m "feat: add application database schema"
```

### 任务 4：建立 Python `rag` schema 迁移边界

**文件：**
- 新建：`services/ai/alembic.ini`
- 新建：`services/ai/migrations/env.py`
- 新建：`services/ai/migrations/script.py.mako`
- 新建：`services/ai/migrations/versions/*_create_rag_schema.py`
- 新建：`services/ai/src/rag_ai/infrastructure/database/settings.py`
- 新建：`services/ai/tests/test_database_settings.py`
- 修改：`services/ai/pyproject.toml`

- [ ] **步骤 1：安装数据库迁移依赖**

运行：

```bash
uv add --project services/ai sqlalchemy alembic "psycopg[binary]"
```

- [ ] **步骤 2：约束迁移归属**

Alembic 的 `version_table_schema` 固定为 `rag`，首个 migration 只执行：

```python
op.execute("CREATE SCHEMA IF NOT EXISTS rag")
op.execute("CREATE EXTENSION IF NOT EXISTS vector")
```

Python migration 禁止创建或修改 `app` schema。

- [ ] **步骤 3：执行和验证**

运行：

```bash
uv run --project services/ai alembic upgrade head
uv run --project services/ai pytest services/ai/tests/test_database_settings.py -q
```

预期：`rag.alembic_version` 存在，`app` 表没有变化。

- [ ] **步骤 4：提交**

```bash
git add services/ai
git commit -m "feat: add rag database migration boundary"
```

### 任务 5：实现本地账号、首个管理员与访问令牌

**文件：**
- 新建：`apps/api/src/auth/auth.module.ts`
- 新建：`apps/api/src/auth/auth.controller.ts`
- 新建：`apps/api/src/auth/auth.service.ts`
- 新建：`apps/api/src/auth/password.service.ts`
- 新建：`apps/api/src/auth/access-token.guard.ts`
- 新建：`apps/api/src/auth/current-user.decorator.ts`
- 新建：`apps/api/src/auth/auth.types.ts`
- 新建：`apps/api/src/auth/auth.service.spec.ts`
- 新建：`apps/api/src/users/users.module.ts`
- 新建：`apps/api/src/users/users.controller.ts`
- 新建：`apps/api/src/users/users.service.ts`
- 修改：`apps/api/src/app.module.ts`
- 修改：`apps/api/src/chat/chat.controller.ts`

- [ ] **步骤 1：安装安全依赖**

运行：

```bash
pnpm --filter @rag/api add @nestjs/jwt argon2 cookie-parser
pnpm --filter @rag/api add -D @types/cookie-parser
```

- [ ] **步骤 2：实现密码与认证主体**

密码只通过 Argon2id 保存：

```ts
export type AuthenticatedUser = {
  id: string;
  username: string;
  role: 'ADMIN' | 'MEMBER';
  tokenVersion: number;
};
```

Access token 有效期 15 分钟，至少包含 `sub`、`role`、`tokenVersion`、`jti`，不包含密码、部门或 ACL 列表。

- [ ] **步骤 3：实现首个管理员引导**

`prisma/seed.ts` 仅在用户表为空且存在 `BOOTSTRAP_ADMIN_USERNAME`、`BOOTSTRAP_ADMIN_PASSWORD` 时创建管理员。已有用户时不修改任何密码。

- [ ] **步骤 4：实现账号管理**

仅管理员可创建、禁用、启用和重置账号。禁用和重置操作递增目标用户 `tokenVersion`，使现有 access token 失效。

- [ ] **步骤 5：替换占位身份**

`POST /chat/stream` 和取消端点使用 `AccessTokenGuard`；传给 Python 的 `userId` 来自验证后的 `AuthenticatedUser.id`，彻底删除 `foundation-user`。

- [ ] **步骤 6：验证并提交**

运行：

```bash
pnpm --filter @rag/api test -- auth
pnpm --filter @rag/api typecheck
```

预期：错误密码、禁用用户、旧 `tokenVersion` 均返回 401；日志不包含密码。

```bash
git add apps/api
git commit -m "feat: add local account authentication"
```

### 任务 6：实现刷新令牌轮换、退出和登录限流

**文件：**
- 新建：`apps/api/src/infrastructure/redis/redis.module.ts`
- 新建：`apps/api/src/infrastructure/redis/redis.service.ts`
- 新建：`apps/api/src/auth/login-rate-limiter.ts`
- 新建：`apps/api/src/auth/refresh-token.service.ts`
- 新建：`apps/api/src/auth/refresh-token.service.spec.ts`
- 修改：`apps/api/src/auth/auth.controller.ts`
- 修改：`apps/api/src/auth/auth.service.ts`

- [ ] **步骤 1：安装 Redis 客户端**

运行：`pnpm --filter @rag/api add redis`

- [ ] **步骤 2：实现 refresh token family**

Refresh token 使用 32 字节随机值，浏览器只接收 `HttpOnly`、`Secure`（生产）、`SameSite=Strict` cookie；数据库只保存 SHA-256 hash。每次刷新在事务中撤销旧 token 并创建同 family 新 token；已撤销 token 被再次使用时撤销整个 family。

- [ ] **步骤 3：实现登录限流和账号冷却**

Redis 限制同一 IP + username 在 5 分钟内最多 10 次；数据库在连续 5 次失败后把账号锁定 15 分钟。Redis 不可用时认证返回可重试的 503，不绕过限制。

- [ ] **步骤 4：实现幂等退出**

`POST /auth/logout` 撤销当前 refresh session、清 cookie；重复调用仍返回 204。`POST /auth/logout-all` 递增 `tokenVersion` 并撤销用户全部 refresh session。

- [ ] **步骤 5：验证并提交**

运行：

```bash
pnpm --filter @rag/api test -- refresh-token
pnpm --filter @rag/api test:e2e
```

预期：轮换后的旧 token 无法再次换取 token；并发刷新只有一次成功。

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat: add rotating sessions and login limits"
```

### 任务 7：实现组织、知识空间和简化授权管理

**文件：**
- 新建：`apps/api/src/organization/organization.module.ts`
- 新建：`apps/api/src/organization/departments.controller.ts`
- 新建：`apps/api/src/organization/groups.controller.ts`
- 新建：`apps/api/src/organization/organization.service.ts`
- 新建：`apps/api/src/spaces/spaces.module.ts`
- 新建：`apps/api/src/spaces/spaces.controller.ts`
- 新建：`apps/api/src/spaces/spaces.service.ts`
- 新建：`apps/api/src/spaces/space-policy.ts`
- 新建：`apps/api/src/spaces/spaces.e2e-spec.ts`
- 修改：`apps/api/src/app.module.ts`

- [ ] **步骤 1：实现组织 CRUD**

管理员可管理部门、用户组和组成员。一个用户最多属于一个部门，可属于多个组。删除被引用主体前返回 409，并给出关联数量。

- [ ] **步骤 2：实现空间 CRUD**

空间包含名称、描述、标签、默认语言、LLM/Embedding/Reranker/ASR/TTS 开关、自动图谱开关、数据出网策略和状态。`graphExtractionEnabled=true` 时强制 `llmEnabled=true`。

- [ ] **步骤 3：实现单一权限等级**

不创建更多系统角色。空间授权只有：

```ts
export type SpacePermission = 'VIEW' | 'EDIT' | 'MANAGE';

export const permissionRank: Record<SpacePermission, number> = {
  VIEW: 1,
  EDIT: 2,
  MANAGE: 3,
};
```

管理员天然拥有 `MANAGE`；普通成员从用户、部门和组 grant 中取最高等级。归档空间默认不可用于问答，但管理员仍可查看和恢复。

- [ ] **步骤 4：验证并提交**

运行：

```bash
pnpm --filter @rag/api test:e2e -- spaces
```

预期：只有 `MANAGE` 可修改成员；`EDIT` 不能修改权限；`VIEW` 只能读取。

```bash
git add apps/api
git commit -m "feat: add organizations and knowledge spaces"
```

### 任务 8：实现统一授权快照和文档 ACL 收紧

**文件：**
- 新建：`apps/api/src/authorization/authorization.module.ts`
- 新建：`apps/api/src/authorization/authorization.service.ts`
- 新建：`apps/api/src/authorization/authorization.types.ts`
- 新建：`apps/api/src/authorization/require-permission.decorator.ts`
- 新建：`apps/api/src/authorization/space-permission.guard.ts`
- 新建：`apps/api/src/authorization/authorization.service.spec.ts`
- 新建：`apps/api/test/authorization.e2e-spec.ts`

- [ ] **步骤 1：定义可复用授权接口**

```ts
export type AuthorizationSnapshot = {
  userId: string;
  revision: bigint;
  admin: boolean;
  departmentId?: string;
  groupIds: string[];
  spaces: Record<string, 'VIEW' | 'EDIT' | 'MANAGE'>;
};

export type DocumentAccessRequest = {
  documentId: string;
  operation: 'SEARCH' | 'CITATION' | 'PREVIEW' | 'DOWNLOAD';
};
```

- [ ] **步骤 2：实现 revision 缓存**

缓存 key 为 `authz:v1:{revision}:{userId}`，TTL 60 秒。任何用户、部门、组、空间 grant、文档 ACL 或文档状态变化都必须在相同 PostgreSQL 事务中递增 `AuthorizationState.revision`；旧缓存自然失效，同时发布主动删除事件。

- [ ] **步骤 3：实现文档 ACL**

无文档 ACL 时继承空间权限；存在 ACL 时必须同时满足空间至少 `VIEW`，且当前用户、部门或任一用户组在允许列表。文档 ACL 永远不能给没有空间 `VIEW` 的主体扩权。

- [ ] **步骤 4：覆盖所有在线入口**

空间读取、搜索参数解析、引用、预览和下载共用 `AuthorizationService`，禁止 controller 自行拼 ACL。Phase 1 尚未实现真实检索和对象下载时，提供受保护的 authorization probe e2e 路径，只用于测试且生产禁用。

- [ ] **步骤 5：验证零越权并提交**

运行：

```bash
pnpm --filter @rag/api test:e2e -- authorization
```

测试矩阵必须覆盖直接用户、部门、组、管理员、无授权、文档 ACL 收紧、撤权、禁用、归档和软删除；所有无权请求均为 403/404，成功越权数为 0。

```bash
git add apps/api
git commit -m "feat: enforce unified resource authorization"
```

### 任务 9：实现不可变审计与事务 Outbox

**文件：**
- 新建：`apps/api/src/audit/audit.module.ts`
- 新建：`apps/api/src/audit/audit.service.ts`
- 新建：`apps/api/src/audit/audit.interceptor.ts`
- 新建：`apps/api/src/audit/audited-action.decorator.ts`
- 新建：`apps/api/src/outbox/outbox.module.ts`
- 新建：`apps/api/src/outbox/outbox.service.ts`
- 新建：`apps/api/src/outbox/outbox.types.ts`
- 新建：`apps/api/src/outbox/outbox.service.spec.ts`

- [ ] **步骤 1：定义事件信封**

```ts
export type OutboxEnvelope<T extends Record<string, unknown>> = {
  eventId: string;
  type: string;
  taskId?: string;
  resourceId: string;
  resourceVersion: number;
  attempt: number;
  traceId: string;
  occurredAt: string;
  payload: T;
};
```

- [ ] **步骤 2：实现同事务写入**

用户、授权、空间和文档状态的变更必须使用同一个 Prisma transaction 同时写业务记录、`AuditLog`、`OutboxEvent` 和 revision。禁止请求完成后再 best-effort 写审计。

- [ ] **步骤 3：保护审计**

API 不提供审计修改和删除；管理员只能分页查询。审计记录包含 actor、action、target、result、IP、request ID、trace ID、reason 和时间，敏感字段在写入前删除。

- [ ] **步骤 4：验证并提交**

运行：

```bash
pnpm --filter @rag/api test -- outbox audit
```

预期：事务回滚时业务、审计和 outbox 全部不存在；成功时三者一起存在。

```bash
git add apps/api
git commit -m "feat: add transactional audit and outbox"
```

### 任务 10：实现 Redis Streams 发布、幂等消费和死信

**文件：**
- 新建：`apps/api/src/outbox/outbox.publisher.ts`
- 新建：`apps/api/src/outbox/stream.consumer.ts`
- 新建：`apps/api/src/outbox/outbox.publisher.spec.ts`
- 新建：`apps/api/test/outbox-redis.e2e-spec.ts`
- 修改：`apps/api/src/outbox/outbox.module.ts`

- [ ] **步骤 1：实现 claim + publish**

发布器每批使用 PostgreSQL `FOR UPDATE SKIP LOCKED` claim 100 条 `PENDING` 事件，`XADD atlas:events` 后标记 `PUBLISHED`。发布前崩溃允许重发，不能把 Redis 当作唯一事件状态。

- [ ] **步骤 2：实现 consumer group**

consumer group 使用 `XREADGROUP`，成功后 `XACK`。业务副作用与 `ProcessedEvent(eventId, consumer)` 唯一记录在同一 PostgreSQL 事务；重复 event ID 只 ACK，不重复写业务。

- [ ] **步骤 3：实现重试和死信**

失败按 `1s, 5s, 30s, 2m, 10m` 退避；第 6 次写入 `atlas:events:dead-letter` 并把 outbox 状态设为 `FAILED`，保留错误码和 trace ID。

- [ ] **步骤 4：验证 Redis 清空与重复投递**

运行：

```bash
pnpm --filter @rag/api test:e2e -- outbox-redis
```

预期：同一 event 重复投递两次只产生一条副作用；`FLUSHDB` 后 PostgreSQL 用户、空间、授权、任务和 outbox 状态仍完整。

- [ ] **步骤 5：提交**

```bash
git add apps/api
git commit -m "feat: bridge postgres outbox to redis streams"
```

### 任务 11：接入 React 登录与空间选择

**文件：**
- 新建：`apps/web/src/features/auth/auth-provider.tsx`
- 新建：`apps/web/src/features/auth/login-page.tsx`
- 新建：`apps/web/src/features/auth/auth-client.ts`
- 新建：`apps/web/src/features/spaces/space-picker.tsx`
- 新建：`apps/web/src/features/auth/login-page.spec.tsx`
- 修改：`apps/web/src/App.tsx`
- 修改：`apps/web/src/features/chat/chat-transport.ts`

- [ ] **步骤 1：实现内存 access token 与 cookie refresh**

Access token 只保存在 React memory；页面加载调用 `/auth/refresh` 恢复会话，refresh token 仅由 HttpOnly cookie 携带。401 时最多自动刷新一次，不形成重试循环。

- [ ] **步骤 2：实现最小登录和空间选择**

登录页包含用户名、密码和可关联 request ID 的错误提示。登录后显示用户可见空间；聊天发送时必须至少选择一个空间。

- [ ] **步骤 3：让聊天 Transport 附加真实身份**

`createChatTransport` 从 auth provider 获取 access token，并发送：

```ts
headers: {
  authorization: `Bearer ${accessToken}`,
  'x-chat-protocol-version': '1',
  'x-trace-id': crypto.randomUUID(),
}
```

请求体的 `selectedSpaceIds` 来自当前选择，不再固定为空数组。

- [ ] **步骤 4：验证并提交**

运行：

```bash
pnpm --filter @rag/web test
pnpm --filter @rag/web typecheck
pnpm --filter @rag/web build
```

```bash
git add apps/web
git commit -m "feat: add authenticated knowledge workspace"
```

### 任务 12：Phase 1 集成验收与文档

**文件：**
- 新建：`apps/api/test/phase1.e2e-spec.ts`
- 新建：`scripts/smoke-auth.mjs`
- 修改：`.github/workflows/ci.yml`
- 修改：`docs/development/quickstart.md`
- 修改：`README.md`

- [ ] **步骤 1：建立真实链路 smoke**

`smoke-auth.mjs` 完成：管理员登录 → 创建成员 → 创建空间 → 给成员 `VIEW` → 成员登录 → 获取空间 → 发起带真实 user ID 的聊天 → 撤权 → 同一成员再次访问被拒绝。

- [ ] **步骤 2：建立 CI 服务容器**

CI 使用 PostgreSQL/pgvector 和 Redis service 跑迁移与核心授权集成测试；Elasticsearch、Neo4j、MinIO 的完整健康检查放入独立 Compose smoke job，避免每个单元测试 job 重复拉取大镜像。

- [ ] **步骤 3：运行全量门禁**

运行：

```bash
pnpm check:workspace
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm infra:check
pnpm smoke:auth
```

预期：

- lint、typecheck、unit、e2e、build 全部通过。
- PostgreSQL 同时存在独立 `app` 和 `rag` migration history。
- 五个中间件从空卷启动后 healthy。
- 未授权空间、文档、引用、预览和下载成功数为 0。
- Redis 清空不丢失任何永久业务状态。
- 重复 Outbox event 不产生重复副作用。
- 聊天链路不存在 `foundation-user`。

- [ ] **步骤 4：更新文档并提交**

Quickstart 必须包含 `.env` 初始化、Compose、Prisma migration、Alembic migration、管理员引导、三个开发进程和 smoke 命令。

```bash
git add .github README.md docs scripts apps/api/test
git commit -m "docs: add phase one operations and acceptance"
```

## Phase 1 完成检查

- [ ] 只有 `ADMIN`、`MEMBER` 两种系统角色。
- [ ] 空间权限只有 `VIEW`、`EDIT`、`MANAGE` 三个递进等级，不扩展为更多角色。
- [ ] 密码仅保存 Argon2id hash，refresh token 仅保存 hash。
- [ ] 禁用、重置、退出和 refresh reuse 都能撤销既有会话。
- [ ] ACL 解析覆盖直接用户、部门和用户组，文档 ACL 只能收紧。
- [ ] 空间、文档、引用、预览和下载越权成功数为 0。
- [ ] 授权变更递增 revision，旧缓存立即不再命中。
- [ ] 业务变更、审计和 Outbox 在同一 PostgreSQL 事务。
- [ ] Redis Streams 重复投递幂等，失败可重试并进入死信流。
- [ ] PostgreSQL 是永久状态真相源，Redis 清空不丢业务。
- [ ] `app` 与 `rag` schema 迁移归属互不越界。
- [ ] Compose 从空卷启动后全部健康。
- [ ] React 和聊天链路使用真实认证主体，不再存在 `foundation-user`。
- [ ] 全量 lint、typecheck、test、build、smoke 与 CI 通过。
