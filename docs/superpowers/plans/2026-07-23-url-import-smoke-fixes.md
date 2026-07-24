# URL 导入冒烟缺陷修复实施计划

> **执行方式：** 使用 `superpowers:executing-plans` 在当前会话逐项执行；遵循用户偏好，仅保留针对已复现缺陷的必要测试。

**目标：** 修复 URL 导入端到端冒烟中发现的 API 响应泄漏与 Windows Worker 事件循环不兼容问题，并重新验证公开网页导入、内容未变化刷新及 SSRF 拦截。

**架构：** API 继续以共享 Zod 合约作为公开边界，`getTask()` 只查询并返回合约允许的字段。Python Worker 在 Windows 明确使用 `SelectorEventLoop`，其他平台保持默认事件循环。修复不新增依赖、不调整已有模块边界。

**技术栈：** NestJS、Prisma、Zod、Python 3.12/3.13、asyncio、pytest、Jest。

---

### 任务 1：收紧导入任务 API 响应

**文件：**
- 修改：`apps/api/src/documents/document-import.service.ts`
- 测试：`apps/api/src/documents/document-import.service.spec.ts`

- [ ] **步骤 1：增加响应边界测试**

在 `document-import.service.spec.ts` 中模拟包含内部字段的 Prisma 数据，并断言 `getTask()` 只返回 `importTaskSchema` 定义的字段，同时断言 Prisma 使用显式 `select`。

- [ ] **步骤 2：实现最小查询投影**

将 `getTask()` 的查询改为显式选择公开任务字段与仅用于鉴权的 `document.spaceId`，鉴权后通过解构移除 `document`：

```ts
const { document: _document, ...publicTask } = task;
return publicTask;
```

- [ ] **步骤 3：运行 API 定向测试**

运行：

```powershell
pnpm.cmd --filter @rag/api test -- document-import.service.spec.ts --runInBand
```

预期：测试通过，前端严格 schema 不再收到 `quarantineObjectKey`、`requestId`、`traceId`、`createdById` 或 `document`。

### 任务 2：修复 Windows Worker 事件循环

**文件：**
- 修改：`services/ai/src/rag_ai/worker_main.py`
- 新建：`services/ai/tests/test_worker_main.py`

- [ ] **步骤 1：增加 Windows 循环工厂测试**

验证 Windows 分支返回 `asyncio.SelectorEventLoop`，避免 psycopg 在 Proactor 循环下抛出 `InterfaceError`。

- [ ] **步骤 2：实现平台事件循环工厂**

增加 `_worker_loop_factory()`：

```python
def _worker_loop_factory() -> asyncio.AbstractEventLoop:
    if sys.platform == "win32":
        return asyncio.SelectorEventLoop()
    return asyncio.new_event_loop()
```

并使用：

```python
asyncio.run(run_worker(), loop_factory=_worker_loop_factory)
```

- [ ] **步骤 3：运行 Python 定向测试**

运行：

```powershell
uv run --project services/ai pytest services/ai/tests/test_worker_main.py -q
```

预期：测试通过。

### 任务 3：重新构建并完成真实冒烟

在重新冒烟时发现当前 Docling 的 `SimplePipeline` 要求 `ConvertPipelineOptions`，项目传入基础 `PipelineOptions` 会让所有 Markdown（包括 URL 抓取生成的 Markdown）解析失败。先增加一个最小兼容修复：

**文件：**
- 修改：`services/ai/src/rag_ai/ingestion/parsers/docling_parser.py`
- 新建：`services/ai/tests/test_docling_parser.py`

- [ ] **步骤 1：使用 Docling 的实际转换选项类型**

将简单格式管线的配置由 `PipelineOptions` 改为 `ConvertPipelineOptions`，继续关闭远程服务和外部插件。

- [ ] **步骤 2：增加并运行 Markdown 解析测试**

创建最小 Markdown 文件，经 `DoclingParser.parse()` 后断言产生正文元素：

```powershell
uv run --project services/ai pytest services/ai/tests/test_docling_parser.py -q
```

预期：测试通过，不再出现缺少 `do_picture_classification` 的 `AttributeError`。

### 任务 4：重新构建并完成真实冒烟

**文件：**
- 临时诊断：`apps/api/prisma/smoke-url-import.ts`（验证完成后删除）

- [ ] **步骤 1：运行静态检查与定向测试**

运行 API lint/typecheck、Web typecheck、AI ruff/mypy 及上述定向测试，预期全部通过。

- [ ] **步骤 2：重建并重启 API 与 Worker**

使用根 `.env` 启动服务，确认 `/health/ready` 返回 200 且 Worker 无 Redis、MinIO、psycopg 错误。

- [ ] **步骤 3：浏览器验证公开 URL**

通过文档管理 UI 导入 `https://www.rfc-editor.org/rfc/rfc9110.html`，确认任务到达 `READY`，文档成为可用版本，且 UI 不再显示 schema 错误。

- [ ] **步骤 4：验证未变化刷新**

点击“刷新页面”，确认新检查任务成功结束、活动版本仍为原版本、临时版本标记为 `CANCELLED / URL_CONTENT_UNCHANGED`。

- [ ] **步骤 5：验证 SSRF**

分别导入直接私网 URL 和公开 URL 重定向到私网地址，确认任务失败且错误码为 `URL_ADDRESS_BLOCKED`。

- [ ] **步骤 6：清理并交付**

删除临时用户、空间和诊断脚本；停止本次冒烟启动的 API/Web/AI/Worker 进程；保留项目基础设施容器。确认工作树仅包含正式修复与计划文件。
