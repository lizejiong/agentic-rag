# 安全 URL 单页导入实施计划

> **给 agentic workers：** 使用 `superpowers:executing-plans` 按任务逐项执行本计划，并用 checkbox（`- [ ]`）跟踪状态。

**目标：** 为知识空间提供真实可用的公开 HTTP/HTTPS 单页导入和手动刷新能力，在所有 DNS 解析与重定向跳转上阻止 SSRF，并把抽取后的正文复用现有文档扫描、切分和发布流水线。

**架构：** NestJS 创建持久化 URL 导入任务，通过事务 outbox 发布抓取命令；专用消费者以独立 Redis consumer group 获取命令，先固定经过校验的公网 IP，再执行限时、限长、手动重定向抓取。正文由 Readability 抽取并转成 Markdown，写入 MinIO 隔离区后发布既有 `document.ingestion.requested.v1`，Python 无需新增网络权限。首次导入和刷新共用同一抓取流程；内容 hash 未变化的刷新只更新检查时间，不创建新的在线版本。

**技术栈：** NestJS 11、Prisma 7、Redis Streams、MinIO、Node.js `http`/`https`/`dns`、`ipaddr.js`、`@mozilla/readability`、`linkedom`、`turndown`、React 19、TanStack Query、Zod。

---

## 文件结构

- `packages/contracts/src/document-import.ts`：URL 请求、响应、抓取事件和新增处理阶段的跨端 Zod 契约。
- `apps/api/prisma/schema.prisma` 与新 migration：URL 来源元数据、最终地址、规范地址、作者、发布时间、抓取/检查时间。
- `apps/api/src/documents/url-address-policy.ts`：URL、DNS 和 IP 公网范围校验，不负责网络 I/O。
- `apps/api/src/documents/url-http-fetcher.ts`：固定已校验 IP、手动重定向、超时和 20 MB 流式限制。
- `apps/api/src/documents/url-content-extractor.ts`：字符集识别、Readability 正文抽取、canonical/author/time 元数据和 Markdown 生成。
- `apps/api/src/documents/document-url-capture.service.ts`：抓取、隔离区写入、hash 去重和后续 ingestion outbox 编排。
- `apps/api/src/documents/document-url-capture.consumer.ts`：Redis Streams 消费、任务认领、失败落库和 ACK。
- `apps/api/src/documents/document-import.service.ts`：首次 URL 导入与现有 URL 文档刷新事务。
- `apps/web/src/features/documents/document-url-import-panel.tsx`：URL 输入、提交、错误反馈和任务轮询入口。
- `docs/development/document-ingestion.md`：运行方式、安全边界和手动验证步骤。

### 任务 1：工作区卫生与依赖

**文件：**

- 修改：`.gitignore`
- 修改：`apps/api/package.json`
- 修改：`pnpm-lock.yaml`

- [ ] 在 `.gitignore` 增加 `.pnpm-store/`，确保本地 pnpm 缓存不进入提交。
- [ ] 运行 `pnpm --filter @rag/api add @mozilla/readability@0.6.0 ipaddr.js@2.4.0 linkedom@0.18.13 turndown@7.2.4`。
- [ ] 运行 `pnpm --filter @rag/api add -D @types/turndown@5.0.6`。
- [ ] 运行 `pnpm install --frozen-lockfile`，预期依赖解析成功且 lockfile 无漂移。

### 任务 2：扩展 URL 导入契约和持久化模型

**文件：**

- 修改：`packages/contracts/src/document-import.ts`
- 修改：`packages/contracts/test/document-import.spec.ts`
- 修改：`apps/api/prisma/schema.prisma`
- 新建：`apps/api/prisma/migrations/20260722_phase2b_url_import/migration.sql`

- [ ] 为处理阶段增加 `FETCHING`；新增严格请求 `{ url: z.url().max(2048) }`、创建响应以及 `document.url.capture.requested.v1` payload，payload 包含 `documentId`、`spaceId`、`versionId`、`importId`、`sourceUrl`、`actorId` 和 ACL snapshot。
- [ ] 在 `DocumentVersion` 增加 `resolvedUrl`、`canonicalUrl`、`sourceAuthor`、`sourcePublishedAt`、`sourceFetchedAt`、`sourceCheckedAt` 可空字段，并把这些字段加入 `documentVersionSchema` 与文档列表查询。
- [ ] SQL migration 为 `app.document_versions` 增加对应列和 `source_url` 索引；枚举在 `PENDING_UPLOAD` 前增加 `FETCHING`。
- [ ] 契约测试覆盖：合法 HTTPS、拒绝额外字段、拒绝非 URL、抓取事件 payload、URL 版本元数据。
- [ ] 运行 `pnpm --filter @rag/contracts test && pnpm --filter @rag/api prisma:generate`，预期全部通过。

### 任务 3：实现可审计的 SSRF 防护与 HTTP 抓取器

**文件：**

- 新建：`apps/api/src/documents/url-address-policy.ts`
- 新建：`apps/api/src/documents/url-address-policy.spec.ts`
- 新建：`apps/api/src/documents/url-http-fetcher.ts`
- 新建：`apps/api/src/documents/url-http-fetcher.spec.ts`

- [ ] `UrlAddressPolicy.resolve(url)` 只接受无用户名/密码的 HTTP/HTTPS URL；用 `dns.promises.lookup(hostname, { all: true, verbatim: true })` 获取全部 A/AAAA，并要求每个地址经 `ipaddr.parse(address).range()` 判定为 `unicast`。显式拒绝 localhost、环回、私网、链路本地、CGNAT、保留、组播、文档地址、IPv4-mapped 私网和云元数据地址。
- [ ] 返回 `{ url, addresses }`，其中地址包含 Node `lookup` callback 所需的 `address` 与 `family`；HTTP 请求只能使用这次校验得到的固定地址，不能再次走系统 DNS。
- [ ] `UrlHttpFetcher.fetch(input)` 使用 Node `http.request`/`https.request`，设置 `Host`/SNI 对应原 hostname，发送固定 User-Agent、`Accept: text/html,application/xhtml+xml,text/plain` 和 `Accept-Encoding: identity`，不发送 Cookie、Authorization 或代理信息。
- [ ] 每个跳转重新调用地址策略；禁止自动跳转，最多 5 次；总超时 30 秒；只允许 2xx；只接受 HTML/XHTML/纯文本；按 `Content-Length` 预检并在读取过程中强制 20 MB 上限；拒绝非 identity content encoding。
- [ ] 单元测试使用注入的 resolver/request adapter，覆盖私网、混合公网/私网 DNS、IPv4-mapped IPv6、恶意重定向、第 6 次跳转、超长 body、错误 MIME、超时和成功固定 IP。
- [ ] 运行 `pnpm --filter @rag/api test -- url-address-policy.spec.ts url-http-fetcher.spec.ts`，预期通过。

### 任务 4：正文抽取和 URL 抓取编排

**文件：**

- 新建：`apps/api/src/documents/url-content-extractor.ts`
- 新建：`apps/api/src/documents/url-content-extractor.spec.ts`
- 新建：`apps/api/src/documents/document-url-capture.service.ts`
- 新建：`apps/api/src/documents/document-url-capture.service.spec.ts`
- 修改：`apps/api/src/infrastructure/object-storage/object-storage.service.ts`

- [ ] `UrlContentExtractor.extract(response)` 从 Content-Type 和前 8 KiB `<meta charset>` 决定受支持字符集，使用 `TextDecoder` 解码；HTML 通过 `linkedom.parseHTML` 与 `Readability.parse()` 提取标题、byline、publishedTime、siteName、excerpt 和正文。
- [ ] 从原 DOM 读取 `link[rel=canonical]` 并相对最终 URL 解析；只保留 HTTP/HTTPS canonical。用 `turndown` 将 Readability HTML 转成 Markdown；纯文本保留段落。正文去除 NUL、规范换行并限制 10,000,000 字符；无有效正文返回 `URL_CONTENT_EMPTY`。
- [ ] 为 `ObjectStorageService` 增加 `putQuarantineBuffer` 薄封装，内部仍调用已有流式 hash/限长逻辑。
- [ ] `DocumentUrlCaptureService.capture(payload)` 调用抓取器与抽取器，生成 UTF-8 Markdown；写入 `imports/{importId}`；在事务中更新 URL 元数据与 hash。如果刷新内容 hash 等于当前 active version，更新 active version 的 `sourceCheckedAt`、取消未发布候选版本并将任务标记成功；否则把任务切回 `QUEUED/QUEUED` 并发布现有 ingestion 事件。
- [ ] 抓取失败仅保存稳定错误码和安全消息，不把响应正文、内网信息或完整异常栈写入数据库。
- [ ] 测试覆盖 HTML/纯文本、中英文字符集、相对 canonical、无正文、首次导入、刷新内容不变、刷新内容变化以及 MinIO/事务失败回滚。
- [ ] 运行 `pnpm --filter @rag/api test -- url-content-extractor.spec.ts document-url-capture.service.spec.ts`，预期通过。

### 任务 5：持久化创建、刷新和异步消费者

**文件：**

- 修改：`apps/api/src/documents/document-import.validation.ts`
- 修改：`apps/api/src/documents/document-import.controller.ts`
- 修改：`apps/api/src/documents/document-import.service.ts`
- 修改：`apps/api/src/documents/document-import.service.spec.ts`
- 新建：`apps/api/src/documents/document-url-capture.consumer.ts`
- 新建：`apps/api/src/documents/document-url-capture.consumer.spec.ts`
- 修改：`apps/api/src/infrastructure/redis/redis.service.ts`
- 修改：`apps/api/src/documents/documents.module.ts`

- [ ] 增加 `POST /spaces/:spaceId/imports/urls`：要求 `EDIT` 权限，在一个事务内创建 URL document、version 1、`QUEUED/FETCHING` task 和 `document.url.capture.requested.v1` outbox，立即返回 task 标识。
- [ ] 增加 `POST /documents/:documentId/refresh-url`：要求原文档为 URL 类型且调用者有 `EDIT` 权限，按最大版本号创建候选版本和抓取任务；已有非终态刷新任务时返回 `URL_REFRESH_IN_PROGRESS`。
- [ ] RedisService 增加 `streamAutoClaim`；消费者使用独立 group `atlas-api-url-capture`，先认领超过 60 秒的 pending 消息再读新消息。只处理 URL capture 事件，其他类型直接 ACK；处理前以条件更新认领 task，完成或稳定失败落库后 ACK。
- [ ] 消费者测试覆盖重复事件、崩溃后 reclaim、非 URL 事件、取消任务、成功链路和安全失败码。
- [ ] 模块注册抓取器、抽取器、编排服务和消费者；网络类以 DI token 暴露，测试不访问真实互联网。
- [ ] 运行 `pnpm --filter @rag/api test -- document-import.service.spec.ts document-url-capture.consumer.spec.ts`，预期通过。

### 任务 6：React URL 导入入口

**文件：**

- 修改：`apps/web/src/features/documents/document-contract.ts`
- 修改：`apps/web/src/features/documents/documents-api.ts`
- 新建：`apps/web/src/features/documents/document-url-import-panel.tsx`
- 新建：`apps/web/src/features/documents/document-url-import-panel.spec.tsx`
- 修改：`apps/web/src/features/documents/document-list-page.tsx`
- 修改：`apps/web/src/styles.css`

- [ ] API client 增加 `createUrlImport(fetcher, spaceId, url)`，使用共享 Zod response schema，不引入 OpenAPI 代码生成或 Axios。
- [ ] URL panel 使用原生 `URL` 做即时 HTTP/HTTPS 校验，提交时禁用按钮，展示稳定错误文案；成功后轮询现有 import task 并触发文档列表刷新。
- [ ] 文档卡片对 URL 来源显示最终域名，并为已成功的 URL 文档提供“刷新页面”按钮；刷新复用同一任务状态展示。
- [ ] 组件测试覆盖无效协议、成功提交、API 错误、重复点击保护和刷新回调。
- [ ] 运行 `pnpm --filter @rag/web test && pnpm --filter @rag/web build`，预期通过。

### 任务 7：集成验证、文档和提交

**文件：**

- 修改：`docs/development/document-ingestion.md`
- 修改：`.env.example`
- 修改：`infra/compose/compose.yaml`
- 视实际测试复用修改：`apps/api/test/phase1.e2e-spec.ts`

- [ ] 环境配置记录 URL 抓取超时、最大响应 20 MB、最大跳转 5 次；Compose 不为抓取器配置代理或浏览器 Cookie。
- [ ] E2E 使用本地受控 HTTP fixture 验证公开页面入库协议；SSRF 单元测试使用注入 resolver，不依赖访问真实内网地址。
- [ ] 文档写明首期不执行 JavaScript、不递归爬取、不支持登录态；JS 强依赖页面返回明确失败。
- [ ] 运行 `pnpm lint && pnpm typecheck && pnpm test && pnpm build`，预期全工作区通过。
- [ ] 运行 `git diff --check` 和 `git status --short`，确认无缓存、密钥和生成物被提交。
- [ ] 按实际边界提交 2–3 个有意义的 commit，推送 `codex/phase2b-url-import` 并创建 draft PR。

## 自审结果

- PRD 8.2、15.2 的协议、DNS、每次跳转、IP、大小、内容类型、无凭证、正文与元数据要求均有对应任务。
- 首期边界明确：单页、无 JS、无登录态、无递归、只手动刷新。
- 抓取内容复用既有安全扫描与解析流水线，Python 服务不获得网络访问权限。
- 计划未引入用户已拒绝的 OpenAPI 生成依赖，也没有把 Axios 用于不需要上传进度的 JSON 请求。
