# 本地快速启动

## 前置环境

- Node.js `>=22.13.0`
- pnpm `11.14.0`
- Python `>=3.12,<3.14`
- uv `0.11.29`
- Docker Desktop 或兼容 Docker Compose 环境

## 1. 初始化配置

在仓库根目录复制两份示例配置：

```bash
cp .env.example .env
cp infra/compose/.env.example infra/compose/.env
```

PowerShell 可使用：

```powershell
Copy-Item .env.example .env
Copy-Item infra/compose/.env.example infra/compose/.env
```

至少替换所有 `change-me-*` 密钥，并确保根 `.env` 的 PostgreSQL、Redis 端口及密码与
`infra/compose/.env` 一致。首次初始化管理员时，在根 `.env` 设置：

```dotenv
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_PASSWORD=请替换为至少12位的本地密码
```

管理员引导只会在用户表为空时执行，不会覆盖已有账号或密码。

## 2. 安装依赖

```bash
corepack prepare pnpm@11.14.0 --activate
pnpm install
uv sync --project services/ai
```

## 3. 启动本地数据平台

```bash
pnpm infra:up
pnpm infra:check
```

健康检查应包含 PostgreSQL/pgvector、Elasticsearch、Neo4j、Redis 和 MinIO。查看状态：

```bash
pnpm infra:ps
```

## 4. 执行迁移与管理员引导

应用 schema 和 RAG schema 由不同迁移工具管理：

```bash
pnpm db:migrate:app
pnpm db:migrate:rag
pnpm db:seed
```

- Prisma 只管理 PostgreSQL `app` schema。
- Alembic 只管理 PostgreSQL `rag` schema。
- 不要用任一工具修改对方的 migration history。

## 5. 启动三个开发进程

终端 A：

```bash
pnpm dev:ai
```

终端 B：

```bash
pnpm dev:api
```

终端 C：

```bash
pnpm dev:web
```

默认地址：

```text
Web: http://127.0.0.1:5173
API: http://127.0.0.1:3000
AI:  http://127.0.0.1:8001
```

Web 的 `/auth` 和 `/api` 请求由 Vite 代理到 NestJS。浏览器不应直接访问 Python AI
服务、数据库或对象存储。

## 6. 验证真实认证与授权链路

三个进程运行后，在第四个终端执行：

```bash
pnpm smoke:auth
```

该 smoke 会执行：管理员登录 → 创建成员 → 创建知识空间 → 授予 `VIEW` → 成员登录 →
查询空间 → 使用真实 user ID 发起聊天 → 撤权 → 验证成员访问被拒绝。也可用独立变量
覆盖 smoke 账号和 API 地址：

```bash
SMOKE_ADMIN_USERNAME=admin \
SMOKE_ADMIN_PASSWORD='your-password' \
SMOKE_API_URL=http://127.0.0.1:3000 \
pnpm smoke:auth
```

仅验证原始流式协议时可运行：

```bash
pnpm smoke:chat
```

## 7. 完整本地门禁

```bash
pnpm check:workspace
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm infra:check
```

单独验证：

```bash
pnpm --filter @rag/api test:e2e
pnpm --filter @rag/web test
uv run --project services/ai pytest services/ai/tests -q
```

## 常见问题

- 登录始终失败：先确认已运行 `pnpm db:seed`，且引导管理员是在空用户表上创建的。
- API 无法连接 PostgreSQL 或 Redis：核对两份 `.env` 的端口和密码是否一致。
- API 无法解析 `@rag/contracts`：先运行 `pnpm prepare:contracts`；`dev:api` 已自动执行。
- Web 返回 409：确认聊天请求头 `x-chat-protocol-version` 精确为 `1`。
- 聊天返回 403：当前账号必须至少拥有一个所选知识空间的 `VIEW` 权限。
- 端口被占用：同时修改 Compose 端口和根 `.env` 连接串，不要只改一侧。
- 需要清理容器但保留代码：运行 `pnpm infra:down`；删除卷会清除本地业务数据。
