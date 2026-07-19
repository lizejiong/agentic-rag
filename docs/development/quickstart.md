# 本地快速启动

## 前置环境

- Node.js `>=22.13.0`
- pnpm `11.14.0`
- Python `>=3.12,<3.14`
- uv `0.11.29`

在仓库根目录安装并锁定依赖：

```bash
corepack prepare pnpm@11.14.0 --activate
pnpm install
uv sync --project services/ai
```

## 启动三个服务

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

端口：

```text
Web: http://127.0.0.1:5173
API: http://127.0.0.1:3000
AI:  http://127.0.0.1:8001
```

Web 的 `/api` 请求由 Vite 代理到 NestJS。NestJS 默认通过 `http://127.0.0.1:8001` 调用 Python；需要覆盖时设置 `AI_SERVICE_URL`。

## 验证

AI 与 API 运行后，可在第四个终端执行真实跨服务 smoke：

```bash
pnpm smoke:chat
```

完整本地校验：

```bash
pnpm check:workspace
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

单独校验：

```bash
pnpm --filter @rag/api test:e2e
uv run --project services/ai pytest services/ai/tests -q
```

## 常见问题

- API 无法解析 `@rag/contracts`：先运行 `pnpm prepare:contracts`；根 `dev:api` 已自动执行该步骤。
- Web 返回 409：确认请求头 `x-chat-protocol-version` 精确为 `1`。
- 端口被占用：结束旧进程后再启动，不要把浏览器直接改为访问 Python。
- 当前 `foundation-user` 是开发占位身份；接入真实数据前必须先完成 Plan 1 的身份、租户与 ACL 测试。
