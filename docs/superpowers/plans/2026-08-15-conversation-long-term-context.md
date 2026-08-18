# 会话级长期上下文实施计划

> **给 agentic workers：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐项执行本计划。步骤使用 checkbox（`- [ ]`）语法跟踪状态。

**目标：** 让同一持久会话在超过当前 10 轮后仍可理解必要的历史话题，同时保持 PostgreSQL 会话记录为唯一事实来源、权限变化即时生效，并确保回答只依据本轮已授权的检索证据。

**架构：** NestJS 在每次运行前从 `chat_turns` 读取并按最新 ACL 过滤可见轮次；它将最近 6 个完整轮次原样传给 AI 服务，并从更早的可见轮次的“用户问题”动态生成、有上限的主题摘要。摘要不落库、不调用模型生成、没有回答和引用内容。Python/LangGraph 只在“短追问”查询改写时使用历史和摘要；回答节点只接收当前问题与本轮检索/图谱证据，不再把会话历史放入回答模型上下文。Redis 继续用于基础设施与任务流，但不再保留未接入的会话记忆实现。

**技术栈：** NestJS、Prisma、Zod、FastAPI/Pydantic、Python、LangGraph、Vitest/Jest、pytest、pnpm、uv。

---

## 交付边界与验收口径

- 本次是“会话级上下文”，不是跨会话用户画像：不引入 Mem0、向量记忆、独立记忆表、记忆编辑 UI 或新的外部服务。
- 不新增数据库迁移。长期信息来自已有的持久 `chat_conversations` / `chat_turns`；新摘要是请求时计算的短生命周期数据。
- 摘要只包含当前仍然 `VISIBLE` 的已完成轮次中的用户问题。权限、文档或空间访问发生变化后，`visibleTurn()` 的现有重新鉴权会令对应轮次成为 `REDACTED`，它不会进入摘要或最近历史。
- 采用明确且可测的预算：最近 6 个完整轮次保留问答原文；更早的轮次仅取最近 20 个用户问题，每题清理空白并截断到 240 字符，整个摘要再限制到 4,000 字符。
- 非追问保持原查询，不额外拼接旧主题；短指代追问使用“旧主题摘要 + 最近一个用户问题 + 当前追问”构造检索查询。摘要和历史永远不是回答证据。
- 新建会话天然没有上下文；归档会话不能继续发问，因而也不会携带其上下文。现有会话列表和聊天记录 UI 不需要新增控件。

## 文件与接口总览

```text
PostgreSQL chat_turns (唯一事实来源)
  └─ ConversationService.contextForRun()
       ├─ history: 最近 6 个已完成、当前可见轮次的问答
       └─ historySummary: 更早、当前可见轮次的用户问题摘要
            │
Nest /chat/stream ── RunRequest(history, historySummary) ──> FastAPI /v1/agent/runs
                                                             │
                                                             └─ LangGraph contextualize
                                                                  ├─ 仅短追问：改写检索 query
                                                                  └─ answer：仅当前问题 + 本轮证据
```

## 任务 1：先用 API 单测锁定动态上下文与 ACL 边界

**文件：**

- 修改：`apps/api/src/chat/conversation.service.spec.ts`
- 修改：`apps/api/src/chat/chat.controller.spec.ts`
- 修改：`apps/api/src/chat/conversation.service.ts`
- 修改：`apps/api/src/chat/chat.controller.ts`

- [ ] 1.1 在 `conversation.service.spec.ts` 先把“仅保留最近十轮”测试替换为 `contextForRun` 的行为测试：构造 12 个完成且可见的轮次，断言返回的 `history` 恰为第 6–11 轮的 12 条 user/assistant 消息；`historySummary` 只含第 0–5 轮的用户问题，不含任何回答。
- [ ] 1.2 增加预算测试：构造超过 26 个完成轮次和超长问题，断言摘要只保留较新的 20 个旧问题、每项和总长度均受上限约束，最近 6 轮仍不受摘要截断影响。
- [ ] 1.3 增加撤权回归测试：让旧轮次的空间或引用文档鉴权抛出 `ForbiddenException`/`NotFoundException`，断言其问题、回答和引用既不出现在 `history`，也不出现在 `historySummary`；保留现有详情页的 `REDACTED` 显示断言。
- [ ] 1.4 在服务实现中导出 `ConversationRunContext`，形如 `{ history: HistoryMessage[]; historySummary: string }`；将 `historyForRun` 改名为 `contextForRun`。复用 `getConversation()` 和 `visibleTurn()`，先筛选 `VISIBLE + COMPLETED + answer`，再按上述 6/20/240/4,000 常量分割和构建摘要。使用显式前缀（例如 `此前已授权的用户话题：`）与项目符号，便于 Python 安全、确定性地取锚点。
- [ ] 1.5 先修改 `chat.controller.spec.ts`：mock `contextForRun()` 的 `history` 和 `historySummary`，断言 `AiEventSource.run()` 同时收到两者；运行失败应能指出控制器尚未适配。
- [ ] 1.6 修改 `chat.controller.ts`，以 `contextForRun()` 取代数组式 `historyForRun()`，将 `context.history` 与 `context.historySummary` 传入内部 AI 请求。不要改变浏览器请求体或 UI 流协议。
- [ ] 1.7 运行并修正此任务的测试：

```powershell
pnpm --filter @rag/api test -- conversation.service.spec.ts chat.controller.spec.ts --runInBand
```

预期：动态摘要、最近窗口、撤权过滤和 Nest→AI 转发均通过；不涉及数据库迁移。

## 任务 2：扩展 TypeScript/Python 内部运行契约，保持跨服务兼容

**文件：**

- 修改：`packages/contracts/src/agent-events.ts`
- 修改：`packages/contracts/test/agent-events.spec.ts`
- 修改：`services/ai/src/rag_ai/contracts/agent_events.py`
- 修改：`services/ai/src/rag_ai/routes/runs.py`
- 修改：`services/ai/tests/test_runs.py`

- [ ] 2.1 先在 TypeScript 契约测试中导入 `runRequestSchema`，验证带 `historySummary` 的合法请求可以解析；验证超过 4,000 字符或未知字段会被拒绝，同时缺省字段仍解析为 `''`。
- [ ] 2.2 在 `runRequestSchema` / `chatRequestSchema` 增加 `historySummary: z.string().max(4000).default('')`。这是 Nest→Python 内部请求字段，不是浏览器 `/chat/stream` 的用户可控字段。
- [ ] 2.3 在 Python `ChatRequest` 中加入等价的 `historySummary: str = Field(default='', max_length=4000)`；保留 `extra='forbid'`，以维持两端严格契约。
- [ ] 2.4 先调整 `test_runs.py` 的 `FakeAgent`：记录 `history_summary`，在发送带摘要的请求后断言 FastAPI 将它原样传给 `Agent.run()`，而历史仍只来自 Nest 请求。失败后再改 `routes/runs.py` 进行转换和透传。
- [ ] 2.5 为 Python 直接构造的 `ChatRequest` 保留默认空摘要，确保评测、取消和旧调用者不需要补字段。
- [ ] 2.6 运行：

```powershell
pnpm --filter @rag/contracts test
uv run --project services/ai pytest services/ai/tests/test_runs.py -q
```

预期：TS/Python 对 4,000 字符边界和默认值一致，内部请求没有破坏既有调用。

## 任务 3：在 LangGraph 中只用上下文改写检索，不让它成为回答依据

**文件：**

- 修改：`services/ai/src/rag_ai/agent/graph_state.py`
- 修改：`services/ai/src/rag_ai/agent/runner.py`
- 修改：`services/ai/src/rag_ai/agent/conversation.py`
- 修改：`services/ai/src/rag_ai/agent/workflow.py`
- 修改：`services/ai/tests/test_agent_conversation.py`
- 修改：`services/ai/tests/test_agent.py`
- 如受影响，修改：`services/ai/tests/test_agent_workflow.py`

- [ ] 3.1 先在 `test_agent_conversation.py` 增加摘要测试：短指代追问在存在 `historySummary` 时构造包含“旧话题 + 最近用户问题 + 当前追问”的有效检索查询；只有摘要没有最近消息时也可以选择摘要最后一个合规用户问题作为锚点；独立问题仍严格保持不变；没有任何合规历史或摘要的指代问题仍返回澄清。
- [ ] 3.2 修改 `resolve_retrieval_query(query, history, history_summary='')`：只在 `is_orphan_reference()` 时读取摘要，清理、截断、只接受由 Nest 生成的项目符号内容，并优先使用最近 user 消息作为直接锚点。不要读取 assistant 内容作为锚点。
- [ ] 3.3 给 `AgentGraphState` 添加 `history_summary`；给 `Agent.run()`、`run_evaluation()` 与 `_initial_state()` 增加默认空字符串参数，避免现有评测调用和单元测试被不必要地破坏。`routes/runs.py` 将已验证的摘要传入 `Agent.run()`。
- [ ] 3.4 修改 `AgentWorkflow._contextualize()`，把 state 的 `history_summary` 传给查询改写函数；检索摘要中的 `contextualized` 标记仍反映是否进行了追问改写。
- [ ] 3.5 先在 `test_agent.py` 加入记录消息的 `ChatModel`：以含有历史 assistant 答案和摘要的运行触发回答，断言回答模型只收到一个当前提示消息，且该消息不包含历史问题、历史回答或 `historySummary`，但仍包含本轮证据。该测试应先因当前 `state["history"] + [...]` 失败。
- [ ] 3.6 修改 `AgentWorkflow._answer()`：把 `messages = state.get("history", []) + [ChatMessage(...)]` 改为只传 `[ChatMessage(role='user', content=prompt)]`。保留 `_build_prompt(state['query'], context)` 与引用生成逻辑，使回答依旧必须由当前检索/图谱证据支撑。
- [ ] 3.7 运行：

```powershell
uv run --project services/ai pytest services/ai/tests/test_agent_conversation.py services/ai/tests/test_agent.py services/ai/tests/test_agent_workflow.py services/ai/tests/test_runs.py -q
uv run --project services/ai mypy services/ai/src
```

预期：超过最近窗口的主题可参与“短追问”的检索改写；任何历史内容都不能越过证据门控进入回答模型。

## 任务 4：移除未接入的 Redis 会话记忆，防止形成第二事实来源

**文件：**

- 删除：`services/ai/src/rag_ai/memory/__init__.py`
- 删除：`services/ai/src/rag_ai/memory/session_memory.py`
- 删除：`services/ai/tests/test_memory.py`
- 修改：`services/ai/src/rag_ai/agent/factory.py`
- 修改：`services/ai/src/rag_ai/settings.py`

- [ ] 4.1 先用 `rg` 确认 `RedisSessionMemoryStore`、`SessionMemory`、`build_memory_store`、`memory_window_turns` 和 `memory_ttl_seconds` 没有生产调用点；当前实现并未被 `build_agent()` 注入，删除不会改变活跃运行路径。
- [ ] 4.2 从 `factory.py` 删除 Redis 导入及未使用的 `build_memory_store()`；从 `WorkerSettings` 删除两项未生效的短期记忆配置。
- [ ] 4.3 删除仅为该未接入实现服务的 memory 包和 Redis 集成测试。保留 Redis 依赖与 Redis Streams/Outbox/worker 的其他用途。
- [ ] 4.4 运行：

```powershell
rg -n "RedisSessionMemoryStore|SessionMemory|build_memory_store|memory_window_turns|memory_ttl_seconds" services/ai
uv run --project services/ai ruff check services/ai
uv run --project services/ai pytest services/ai/tests -q
```

预期：第一条命令无匹配；Python 静态检查和完整测试通过，且不再需要 Redis 的会话记忆测试。

## 任务 5：更新可运行文档与路线图状态

**文件：**

- 修改：`README.md`
- 修改：`docs/architecture/008-langgraph-main-flow.md`
- 修改：`docs/superpowers/plans/2026-07-18-enterprise-rag-master-roadmap.md`

- [ ] 5.1 将 README 的“Redis 会话记忆”与“基于 Redis 短期历史”改为“持久会话的动态上下文（旧轮次问题摘要 + 最近可见问答）”，明确 PostgreSQL 会话记录是唯一事实来源。
- [ ] 5.2 在 LangGraph 架构文档中记录上下文边界：Nest 依照最新 ACL 动态生成摘要；摘要和历史只用于检索查询改写；回答 prompt 不包含它们；权限撤销后旧轮次不会重用。
- [ ] 5.3 更新主路线图：将本次最小会话级长期上下文记为已交付，但仍明确 Mem0/跨会话画像、Langfuse、Studio 和 Deep Agents 不在本次范围、尚未开始。不要把“长期记忆”泛称为已全部完成。
- [ ] 5.4 复查文档不承诺不存在的 UI、持久摘要表或 Redis 会话记忆。

## 任务 6：完整质量门与体验验收

- [ ] 6.1 执行完整项目质量门：

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

- [ ] 6.2 本地人工体验（无需新 UI）：在同一会话连续完成至少 7 个有答案的问答，再输入“它是谁负责的？”或“那两个方案有什么区别？”。确认流状态正常、检索摘要显示 `contextualized: true`、答案仍带本轮引用；新建会话输入同一指代问题应要求澄清。
- [ ] 6.3 权限回归：生成一个包含受限空间或已撤销文档引用的历史轮次，撤销访问后刷新会话并再次追问。确认历史该轮显示脱敏、后续 AI 请求不携带其内容，并且答案没有复述它。
- [ ] 6.4 仅在以上命令全部通过后检查 diff，按逻辑拆分提交：
  1. `feat: add acl-safe conversation context`（任务 1–3）
  2. `chore: remove unused redis session memory`（任务 4–5）
  不把 `.pytest-tmp-ci/` 或其他工作树、根目录未跟踪计划文件纳入提交。

## 不做的事

- 不引入 LLM 自动总结，避免额外费用、异步刷新、总结幻觉和撤权失效问题。
- 不把历史回答、引用片段或图谱事实复制进摘要；它们均可能绕开“当前证据”约束。
- 不创建跨会话、跨空间或跨用户记忆；空间与文档 ACL 仍只由既有授权服务和当次快照决定。
- 不改聊天页面布局或新增“记忆管理”入口；用户通过“新建会话”获得无上下文对话，通过现有归档结束一个会话。
