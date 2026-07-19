# 002：流式事件、背压与取消契约

状态：已接受（Plan 0）

## Python → NestJS：NDJSON

- 响应媒体类型为 `application/x-ndjson`。
- 每行只包含一个 UTF-8 JSON 对象并以 `\n` 结束。
- 单条编码记录（包含换行）必须小于 64 KiB；达到或超过 65,536 bytes 立即拒绝。
- Python 输出前使用严格 Pydantic 模型校验并省略未设置的 `null` 可选字段。
- NestJS 增量解码 UTF-8，只在处理完当前 `AgentEvent` 后读取下一条记录；一个大网络 chunk 可以包含多条小记录，限制针对单条记录而不是整个 chunk。
- 未终止缓冲区或完整记录达到上限时，NestJS 立即终止流。

## 事件状态机

`seq` 从 `0` 开始连续递增。缺号、重复或乱序立即终止流。

正常路径：

```text
run.started
→ run.status*
→ text.delta*
→ citation*
→ run.completed(finishReason=stop)
```

取消路径以 `run.completed(finishReason=cancelled)` 结束；失败路径以 `run.failed` 结束。终态之后不得再发送事件。

NestJS 对每条事件再次使用共享 Zod schema 校验，然后映射为 AI SDK UI Message Stream。它不向浏览器发送模型思维链。

## NestJS → 浏览器：AI SDK SSE

- 客户端必须发送 `x-chat-protocol-version: 1`。
- 不支持或缺失的版本在调用 AI 服务前返回 `409 CHAT_PROTOCOL_VERSION_UNSUPPORTED`。
- 响应头包含 `x-vercel-ai-ui-message-stream: v1`。
- 文本使用 `text-start`、`text-delta`、`text-end`；引用使用类型化 `data-citation`；流以 `finish` 和 SSE `[DONE]` 收尾。
- 浏览器只接收经过 allowlist 的引用数据，不接收 ACL、内部存储位置或思维链。

## 取消传播

显式取消：

```text
POST /chat/:requestId/cancel
→ NestJS AbortController.abort()
→ DELETE /v1/agent/runs/:requestId
→ Python cancel event.set()
→ run.completed(cancelled)
```

客户端断开：

```text
HTTP request aborted / response closed
→ NestJS AbortController.abort()
→ Python fetch 中止
→ PythonAiClient finally 中 best-effort DELETE cancel
```

取消端点幂等：未知或已结束的运行也可以重复取消，不创建新的运行状态。NestJS 与 Python 的活动运行注册表都拒绝重复活动 `requestId`，并使用句柄身份检查防止陈旧清理删除新的运行。

Python 生成器在下一次 `yield` 前检查 cancel event。NestJS 在流结束、异常或断开时清理活动运行，使同一 `requestId` 可以安全重试。
