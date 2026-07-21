# 前端架构优化实施计划

> **给 agentic workers：** 必需子技能：使用 `superpowers:executing-plans` 按任务逐项执行本计划。步骤使用 checkbox（`- [ ]`）语法跟踪状态。

**目标：** 在不改变现有登录、知识空间选择和流式问答行为的前提下，建立可扩展的路由、服务端状态、API 访问和 feature-first UI 边界。

**架构：** 使用 React Router Declarative Mode 管理公开/受保护页面，使用 TanStack Query 管理空间等服务端状态，保留 Vercel AI SDK 的 `fetch` 流式传输。统一 JSON 请求、错误和 Zod 边界校验，但不引入 Axios；将 `ChatPage` 拆为编排层和纯 UI 组件。

**技术栈：** React 19、Vite、React Router、TanStack Query、Vercel AI SDK UI、Zod、Vitest、Testing Library。

---

## 文件边界

```text
apps/web/src/
├── app/
│   ├── app-providers.tsx       # QueryClient 和其他全局 provider
│   ├── app-router.tsx          # 路由表和认证守卫
│   └── query-client.ts        # 全局查询默认值
├── shared/api/
│   ├── api-error.ts           # 统一可展示错误
│   └── request-json.ts        # fetch + request/trace ID + Zod 解析
├── features/auth/              # 会话和登录，不保存服务端业务数据
├── features/spaces/
│   ├── space-contract.ts      # 单一空间契约来源
│   ├── spaces-api.ts          # REST 边界
│   └── use-spaces-query.ts   # TanStack Query 适配层
└── features/chat/
    ├── chat-page.tsx           # 仅编排 chat/space 状态
    ├── conversation-view.tsx   # 消息和空状态
    └── chat-composer.tsx       # 输入、提交、停止和状态
```

`styles.css` 本次不做全量 CSS Modules 迁移，避免与架构改动叠加视觉回归；新功能从 Phase 2 开始在各 feature 内使用局部样式文件。

### 任务 1：建立应用 Provider 和路由边界

**文件：**
- 修改：`apps/web/package.json`
- 新建：`apps/web/src/app/query-client.ts`
- 新建：`apps/web/src/app/app-providers.tsx`
- 新建：`apps/web/src/app/app-router.tsx`
- 修改：`apps/web/src/App.tsx`
- 修改：`apps/web/src/features/auth/login-page.spec.tsx`

- [x] 安装 `react-router` 和 `@tanstack/react-query`，使用 pnpm 更新 lockfile。
- [x] 创建唯一 `QueryClient`：查询默认 `staleTime: 30_000`、`retry` 仅允许非 4xx 错误重试一次，mutation 不自动重试；匿名会话清空跨身份缓存。
- [x] 创建 `/login` 和 `/chat` 路由；加载会话时显示原有 loading UI，未登录访问 `/chat` 跳转 `/login`，已登录访问 `/login` 跳转 `/chat`。
- [x] 让 `App` 只负责组装 `AppProviders` 和 `AppRouter`。
- [x] 调整登录测试使用内存路由或 jsdom history，保留“登录失败显示 request ID”的关键验收。
- [x] 运行 `pnpm --filter @rag/web test` 和 `pnpm --filter @rag/web typecheck`，预期通过。

### 任务 2：统一 REST JSON 请求和错误

**文件：**
- 新建：`apps/web/src/shared/api/api-error.ts`
- 新建：`apps/web/src/shared/api/request-json.ts`
- 修改：`apps/web/src/features/auth/auth-client.ts`
- 修改：`apps/web/src/features/auth/login-page.tsx`
- 新建：`apps/web/src/shared/api/request-json.spec.ts`

- [x] 定义 `ApiError(status, requestId, code)`，将错误 body 中的字符串/字符串数组 `message` 归一化为 `code`。
- [x] 实现 `requestJson(schema, input, init)`：默认填充 `x-request-id`/`x-trace-id`、保留调用方 headers、对非 2xx 抛出 `ApiError`、对成功 body 进行 Zod 解析。支持传入自定义 `fetcher`，使授权 fetch 仍可复用它。
- [x] 将 login/refresh 改为调用 `requestJson`；logout 保留无 body 请求，但复用 request/trace header helper。
- [x] 添加两个小测试：成功响应按 schema 解析；非 2xx 保留 request ID 和归一化 code。
- [x] 运行 Web 单测与 typecheck，预期通过。

### 任务 3：将知识空间改为服务端状态

**文件：**
- 新建：`apps/web/src/features/spaces/space-contract.ts`
- 新建：`apps/web/src/features/spaces/spaces-api.ts`
- 新建：`apps/web/src/features/spaces/use-spaces-query.ts`
- 修改：`apps/web/src/features/spaces/space-picker.tsx`
- 修改：`apps/web/src/features/chat/chat-page.tsx`

- [x] 将 `visibleSpaceSchema` 和 `VisibleSpace` 放在同一契约文件，删除组件与页面中的重复类型。
- [x] 实现 `listVisibleSpaces(fetcher, signal)` REST 函数，使用 `requestJson` 做运行时校验。
- [x] 实现 `useSpacesQuery(fetcher)`，query key 固定为 `['spaces', 'visible']`，使用 TanStack Query 传入的 `signal`。
- [x] 删除 `ChatPage` 中手写的 fetch/loading/error effect；仅保留“可见空间变化时修正当前选中项”的局部 effect。
- [x] 运行 Web 单测和 typecheck，预期通过。

### 任务 4：拆分聊天页 UI 责任

**文件：**
- 新建：`apps/web/src/features/chat/conversation-view.tsx`
- 新建：`apps/web/src/features/chat/chat-composer.tsx`
- 修改：`apps/web/src/features/chat/chat-page.tsx`
- 新建：`apps/web/src/features/chat/chat-composer.spec.tsx`

- [x] 将空状态和消息列表移入 `ConversationView`，通过 `RagUIMessage[]` 传入，不让其依赖 auth、transport 或空间 API。
- [x] 将 input、Enter/Shift+Enter、发送/停止按钮、Agent 状态和错误展示移入 `ChatComposer`，用 `onSend(text)`/`onStop()` 窄接口与编排层交互。
- [x] `ChatPage` 只保留 `useChat`、transport、selected space IDs 和两个纯 UI 组件的组装。
- [x] 添加一个组件测试，验证 Enter 发送、Shift+Enter 不发送以及无空间时禁用。
- [x] 运行 Web 单测、typecheck 和 build，预期通过。

### 任务 5：全量验证与架构记录

**文件：**
- 新建：`docs/architecture/004-frontend-architecture-and-libraries.md`
- 修改：`docs/superpowers/plans/2026-07-21-frontend-architecture.md`

- [x] 记录“不采用 Axios/OpenAPI 生成客户端、采用 React Router/TanStack Query、继续使用共享 contracts + Zod”的决策、边界和退出策略。
- [x] 运行 `pnpm check:workspace`、`pnpm lint`、`pnpm typecheck`、`pnpm test` 和 `pnpm build`。
- [x] 运行 `git diff --check`，确认没有空白错误或无关文件。
- [x] 对照本计划进行一次自检，将已完成项更新为 `[x]`。

## 非本次范围

- 不引入 Axios、Zustand、Socket.IO、Cytoscape 或文档预览库。
- 不修改 NestJS API、认证策略、聊天流协议或视觉设计。
- 不在此批次实施全量 CSS Modules 迁移。
- 不为每个纯展示组件增加单元测试。
