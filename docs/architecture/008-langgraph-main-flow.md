# LangGraph 主问答流程

## 范围

Python AI 服务以 LangGraph 1.2 的 `StateGraph` 执行只读问答流程。对外仍保持既有 NDJSON `AgentEvent` 协议；图内事件仅为内部 custom stream，不能作为浏览器契约。

```text
understand
  ├─ 无可见空间 ────────> refuse
  └─ contextualize
       ├─ 无上下文的短指代 ─> clarify
       └─ classify -> retrieve
       └─ rank / build-context
            ├─ 证据充分 ─> answer
            ├─ 首次不足 ─> rewrite ─> retrieve
            └─ 仍然不足 ─> refuse
```

`contextualize` 仅对短小的指代追问读取最近一条 user 历史消息；它将前序问题与本轮追问构造成 `effective_query`，供文档混合检索、图谱查询和证据重排使用。assistant 历史不作为检索锚点。无历史时仍澄清，不猜测实体。关系类问题在 `retrieve` 节点同时执行文档混合检索和图谱查询；其他问题只执行文档检索。查询改写最多一次，图配置 `recursion_limit=12`，因此不会形成无界循环。

## 证据规则

- 图谱只读取当前 ACL 可见空间内、已发布的关系。
- `GraphEvidenceCandidate` 保留关系语义及其原始文档片段，不伪造 rerank/RRF 分数。
- 文档与图谱证据进入同一个 token/chunk 上限；原始 chunk 按 ID 去重，图谱关系按 `(relation_id, chunk_id)` 去重。
- 文档证据按现有 rerank/RRF 阈值判断；有效的已发布图谱证据可独立满足关系题的证据门槛。
- 每条最终引用都指向原始 chunk/document，而非图谱关系的合成文本。

## 流式与取消

节点使用 LangGraph `custom` stream 发出内部 `status`、`retrieval`、`token`、`citation` 事件；`Agent` runner 是唯一的 NDJSON 映射器和 sequence 分配者。每次检索摘要都包含 `attempt`、原问题 `originalQuery`、实际生效查询 `query` 与 `contextualized` 标记。回答 prompt 继续使用本轮原问题；历史只参与检索词构造，不能成为回答证据。

检索及模型取词都会与请求的取消事件竞速。取消发生时，未完成任务被取消并等待回收；runner 只发送 `run.completed`（`finishReason=cancelled`），不会再泄露 token、citation 或失败事件。

## 运行与评测

聊天与评测均通过同一张图：聊天调用 `astream(..., stream_mode="custom", version="v2")`，评测调用 `ainvoke`。开发验证至少覆盖：路由、双通道证据、单次改写、引用、图谱 ACL、图内 token 流、检索取消及既有 NDJSON 契约。
