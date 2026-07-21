# 前端架构与基础库决策

状态：Accepted
日期：2026-07-21
范围：React 应用路由、服务端状态、REST 请求、流式传输与 UI 模块边界

## 背景

Phase 1 前端已经打通登录、空间授权和 AI SDK 流式问答，但页面组件同时承担请求生命周期、运行时校验、业务状态和展示。文档管理、导入任务、知识图谱和语音加入后，继续使用 `useEffect + useState` 管理服务端数据会重复实现缓存、取消、重试、失效和错误处理。

本次只建立后续功能需要的稳定边界，不引入尚未产生实际收益的通用状态库、上传库、图谱库或语音协议库。

## 决策

### React Router：采用 Declarative Mode

- 使用 `react-router` 管理 `/login`、`/chat` 和后续业务页面。
- 认证守卫只依据 `AuthProvider` 的会话状态决定加载、放行或重定向；服务端仍是授权真相源。
- 当前数据生命周期由 TanStack Query 管理，因此不同时引入 Router loader/action，避免两套请求缓存模型。
- 退出策略：路由组件不持有业务数据，可按需迁移到 Data/Framework Mode。
- 许可证：MIT。

### TanStack Query：采用

- 管理空间、文档、导入任务、图谱视图元数据等服务端状态。
- query key 由 feature 定义；API 函数不依赖 React，hook 只负责 Query 适配。
- 默认 stale time 为 30 秒；4xx 不重试，网络错误和 5xx 最多重试一次；mutation 默认不自动重试。
- 会话变为匿名时清空 Query Cache，避免同一浏览器切换账号后保留上一身份的空间或文档数据。
- AI SDK 流式消息和音频播放不是普通 server-state query，不放入 Query Cache。
- 退出策略：feature API 是普通 Promise 函数，可更换缓存层而无需修改后端协议。
- 许可证：MIT。

### Axios：不采用

- 浏览器、Vercel AI SDK Transport、AbortSignal 和后续流式响应均以原生 `fetch` 为共同能力。
- Axios 拦截器可以集中鉴权，但不能替代 TanStack Query 的缓存、去重、失效和 mutation 生命周期。
- 同时维护 Axios 和 AI SDK `fetch` 会形成两套鉴权、错误、取消与 trace 逻辑。
- 重新评估条件：必须接入只提供 Axios adapter 的外部 SDK，或 Node/浏览器统一传输出现原生 `fetch` 无法满足的明确需求。

### 项目内 `requestJson`：采用窄封装

- 统一生成 `x-request-id`、`x-trace-id`，保留调用方 headers，并将非 2xx 响应转换为 `ApiError`。
- 所有成功 JSON 响应必须经过 Zod schema 的运行时验证。
- 支持注入 `fetcher`，让携带 access token 和单航班 refresh 的 `authorizedFetch` 继续作为认证边界。
- 不在封装内实现缓存、业务 toast、无限重试或具体 feature 的 DTO。

### OpenAPI 类型客户端：不采用

- 不引入 `openapi-fetch`、`openapi-typescript` 或额外的客户端代码生成流水线。
- React 与 NestJS 同属 TypeScript monorepo，继续使用稳定的 `packages/contracts` 共享跨边界类型，并在 feature API 使用 Zod 做运行时校验。
- 项目内窄 `fetch` 封装已经覆盖 trace、错误、鉴权 fetch 注入和 schema 解析；生成客户端会额外增加 schema 发布、代码生成、版本同步和 CI 维护成本。
- 只有现有共享契约无法表达真实接口并已产生可量化缺陷时，才重新评估，而不是将其视为默认演进方向。

### 通用客户端状态库：暂不采用

- access token 仍只存 React memory；会话由 AuthProvider 管理。
- 查询结果进入 TanStack Query，聊天输入、空间选择和引用展开保持组件局部状态。
- 只有图谱过滤器、跨页面上传队列或语音播放状态出现真实跨路由共享需求时，才评估 Zustand 或状态机库。

## 目录边界

```text
src/app/                 应用装配、Router、QueryClient
src/features/<feature>/  契约、API、query hooks 与 UI
src/shared/api/          与业务无关的 HTTP 错误和 JSON 请求原语
```

- 页面只编排 feature，不直接解析响应 JSON。
- `features/*/api` 不依赖 React；`use-*-query` 是唯一 TanStack Query 适配层。
- 不创建无限增长的全局 `services`、`hooks` 或 `utils` 目录。
- `styles.css` 作为 Phase 1 视觉基线暂时保留；Phase 2 新增 feature 使用局部样式文件，待组件体系稳定后再决定是否统一迁移 CSS Modules 或 Radix primitives。

## 后续按需引入

- 文档上传：`react-dropzone`，仅负责选择、拖放和前端预校验。
- 复杂表单：`react-hook-form` 与 Zod resolver。
- 文档表格：TanStack Table；出现大量可视行后再加入 TanStack Virtual。
- 无障碍弹窗、菜单和选择器：按需采用 Radix primitives，不整体替换当前视觉设计。
- 图谱：在 Phase 4 根据节点规模和交互需求比较 Cytoscape 与 Sigma，而非提前锁定。
- 语音：后端协议确定为原生 WebSocket 或 Socket.IO 后，再选择对应客户端。
