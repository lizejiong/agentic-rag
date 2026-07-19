# 企业级 Agentic RAG 实施总路线图

> **执行要求：** 实施时必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，并使用 checkbox（`- [ ]`）逐项跟踪。每个子计划都在独立 `codex/` 分支和 worktree 中执行。

**目标：** 从当前仅包含 PRD 的空仓库，渐进交付一个可私有化部署、可验证引用、支持多格式文档、混合检索、知识图谱、Agent、记忆和半双工语音的企业知识平台。

**架构：** React + Vercel AI SDK UI 负责聊天交互；NestJS 是身份、权限、业务数据和外部流协议的唯一入口；Python 服务负责解析、检索、LangGraph、图谱、记忆、评测和模型适配。长任务通过 PostgreSQL Outbox + Redis Streams 传递，文本流使用 Python NDJSON → NestJS AI SDK UI Message Stream，音频使用独立 WebSocket。

**技术栈：** pnpm workspace、React、Vite、Vercel AI SDK UI、NestJS、Python、FastAPI、LangGraph、可选 Deep Agents、PostgreSQL/pgvector、Elasticsearch、Neo4j、Redis、MinIO、Mem0、Langfuse、Prometheus、Grafana、Docker Compose。

---

## 1. 规划原则

- 每个子计划都必须产生可运行、可测试、可演示的软件增量。
- 后续详细计划在前一计划通过出口检查后编写，以实际仓库结构和接口为准，避免在空仓库中臆造后期文件。
- 所有行为变更遵循 TDD：先写失败测试，确认失败，再做最小实现。
- 每个任务形成一个小提交；禁止把多个独立子系统压进同一个提交。
- NestJS 是授权真相源；Python、Elasticsearch、Neo4j、MinIO 和浏览器都不能自行扩大权限。
- 任何外部模型调用都通过 Python 模型适配层，并写入数据出网审计与 Langfuse Trace。
- Deep Agents 只在计划 5 中实验；未通过 PRD 第 9.6.1 节门槛时不进入生产 Compose。

## 2. 子计划与依赖顺序

| 顺序 | 子计划 | 可独立交付的软件增量 | 前置 |
|---:|---|---|---|
| 0 | 仓库骨架与流协议 | React → NestJS → Python 的可取消假流式问答，CI 通过 | 无 |
| 1 | 本地数据平台与身份权限 | Docker Compose 数据层、本地账号、两角色、空间 ACL、审计 | 0 |
| 2 | 文档导入与生命周期 | 全格式上传、URL 单页、OCR/解析适配、版本、任务、删除恢复 | 1 |
| 3 | 混合检索与可验证问答 | pgvector + BM25 + RRF + Reranker、SSE 引用、反馈、短期记忆 | 2 |
| 4 | 知识图谱治理 | Neo4j 候选图谱、证据绑定、审核发布、图谱浏览与多跳查询 | 3 |
| 5 | Agent、长期记忆与评测 | LangGraph 路由、Mem0、Langfuse、评测中心、Deep Agents 实验 | 4 |
| 6 | 流式语音与生产加固 | ASR/TTS、WebSocket 播放、监控、备份恢复、安全和容量验收 | 5 |

## 3. 计划 0：仓库骨架与流协议

**详细计划：** `docs/superpowers/plans/2026-07-18-foundation-and-streaming-contract.md`

**交付：**

- pnpm monorepo、Python `uv` 项目和统一质量命令。
- React/Vite、NestJS、FastAPI 三个可独立启动的进程。
- 跨 TypeScript/Python 的 `AgentEvent` JSONL 契约。
- Python 假 Agent 增量输出 NDJSON。
- NestJS 逐条读取 NDJSON，并转换成 AI SDK UI Message Stream。
- React `useChat` 展示文本、状态、引用和取消。
- 客户端断开 → NestJS AbortController → Python 取消的传播测试。
- CI 执行 lint、typecheck、unit tests 和 build。

**出口：**

- `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过。
- Python 与 TypeScript 对同一 JSONL fixture 校验一致。
- NestJS 响应包含 `x-vercel-ai-ui-message-stream: v1`。
- 假答案可在浏览器逐字显示，取消后 Python 生成器停止。
- 浏览器、NestJS 和 Python 的 request ID、trace ID 一致。

## 4. 计划 1：本地数据平台与身份权限

**范围：**

- Docker Compose：PostgreSQL/pgvector、Elasticsearch、Neo4j、Redis、MinIO。
- `app` PostgreSQL schema 由 NestJS 迁移管理；`rag` schema 由 Python 迁移管理。
- 本地账号、密码哈希、访问/刷新令牌轮换、登录限流。
- 管理员与普通成员两个系统角色。
- 部门、用户组、知识空间和 `view/edit/manage` 权限。
- 文档 ACL 只能在空间权限上进一步收紧。
- 审计日志、Outbox、Redis Streams 消费组和死信流。
- 当前 ACL 解析服务和 `authorization_revision` 缓存失效。

**出口：**

- 空间、文档、引用和下载越权测试全部通过，未授权成功数为 0。
- PostgreSQL 是任务和授权真相源；Redis 清空后永久业务状态不丢失。
- Outbox 事件重复消费不产生重复记录。
- Compose 从空卷启动后健康检查全部通过。

## 5. 计划 2：文档导入与生命周期

**范围：**

- PDF、DOCX、DOC、XLSX、XLS、PPTX、PPT、TXT、MD、CSV、JSON。
- 单页 URL 安全抓取与 SSRF 防护。
- 文件签名、MIME、病毒、压缩炸弹和解析资源限制。
- LibreOffice 隔离转换、扫描 PDF OCR、Office 关键图片 OCR。
- 规范化文档模型、结构感知切分、页码/表格/工作表/幻灯片位置。
- `processing_status` 与 `availability_status` 双状态机。
- 内容哈希、同空间去重、跨空间存储对象引用计数、文档版本和原子发布。
- 软删除、30 天恢复、物理清理和一致性修复。

**出口：**

- 每种格式的正常、损坏、超限和中英文 fixture 全部通过。
- 新版本索引完成前旧版本保持在线。
- BM25-only 空间不生成向量也能发布。
- 删除后所有在线入口不可命中；恢复必须重建索引后才重新 `ACTIVE`。

## 6. 计划 3：混合检索与可验证问答

**范围：**

- 平台级 Embedding 索引代次和空间级能力开关。
- pgvector Top 50、Elasticsearch BM25 Top 50。
- RRF `k=60` 合并 Top 30，Reranker 输出 Top 10。
- 父块、邻接块、标题和表格上下文扩展。
- 检索阶段 ACL 过滤和多空间最严格策略。
- 默认 LangGraph 简单路由、证据充分性、最多一次查询重写。
- AI SDK `data-agent-status`、`data-retrieval-summary` 和 `data-citation`。
- `citation_id` 打开时由 NestJS 按最新 ACL 重新鉴权。
- Redis 滑动窗口、会话摘要和问答反馈。

**出口：**

- Recall@10 ≥ 0.85、nDCG@10 ≥ 0.75。
- 引用准确率 ≥ 0.95，撤权后引用预览在 5 秒内失效。
- 证据不足案例能够澄清或拒答。
- 50 路默认问答压测不受后台导入任务拖垮。

## 7. 计划 4：知识图谱治理

**范围：**

- 实体类型、关系类型和抽取策略版本。
- 候选实体/关系、置信度、来源块和文档版本。
- 草稿与发布图谱隔离。
- 审核、驳回、合并、拆分、纠错、发布和回滚。
- 文档更新后的待复核、删除后的证据解绑。
- 实体搜索、关系浏览、路径查看和来源打开。
- 受限只读 Cypher 模板、路径预算和原文证据回填。

**出口：**

- 进入回答上下文的图谱关系 100% 有当前有效文档证据。
- 未发布关系不会作为组织事实展示。
- 文档删除后无证据自动关系不可继续服务。
- 图谱治理操作全部可审计和回滚。

## 8. 计划 5：Agent、长期记忆与评测

**范围：**

- 完整 LangGraph 状态图：查询理解、复杂度、工具路由、证据门控、回答/澄清/拒答。
- 用户 Mem0 长期记忆、管理员组织记忆、写入门控和删除。
- LangGraph Studio 本地调试。
- 内网自托管 Langfuse、Prompt/策略版本和 Trace 脱敏。
- 200+ 问题评测集、离线运行、指标和版本比较。
- Deep Agents 独立资源池、最多 2 个只读子 Agent、A/B 评测和采用决策。

**出口：**

- 答案忠实度 ≥ 0.90，不可回答处理正确率 ≥ 0.85。
- 用户可查看、编辑、关闭和删除私有长期记忆。
- Deep Agents 产生可复现报告；未过门槛时保持关闭且不阻塞发布。
- 任一新策略未通过三次完整评测不得成为默认版本。

## 9. 计划 6：流式语音与生产加固

**范围：**

- WebSocket 音频输入、流式 ASR 中间/最终文本。
- SSE 文本和按完整句切分的流式 TTS。
- 带 sequence 的音频分片、顺序缓冲、停止生成和停止播报。
- OpenTelemetry、Prometheus、Grafana、结构化日志和告警。
- 数据出网策略、PII/密钥脱敏和供应商审计。
- PostgreSQL、MinIO、Neo4j 和配置备份；索引重建与恢复演练。
- 50 路问答、5 路实验研究、并行导入和故障注入。

**出口：**

- ASR 中间结果 P95 ≤ 1 秒，首段 TTS P95 ≤ 2.5 秒。
- 默认问答首字 P95 ≤ 6 秒，混合检索 P95 ≤ 1.5 秒。
- 月度可用性目标 99.5%，RPO ≤ 24 小时，RTO ≤ 8 小时。
- 高危漏洞为零，恢复演练和索引重建均有成功报告。

## 10. PRD 追踪矩阵

| PRD 章节 | 落地计划 |
|---|---|
| 6 用户与权限 | 计划 1 |
| 8.1–8.2 文件/URL 导入 | 计划 2 |
| 8.3 AI 问答 | 计划 0、3、5 |
| 8.4 语音问答 | 计划 6 |
| 9.1–9.3 身份、空间、文档 | 计划 1、2 |
| 9.4 解析与切分 | 计划 2 |
| 9.5 混合检索 | 计划 3 |
| 9.6 Agentic RAG | 计划 3、5 |
| 9.7 回答与引用 | 计划 0、3 |
| 9.8 知识图谱 | 计划 4 |
| 9.9 记忆 | 计划 3、5 |
| 9.10 语音 | 计划 6 |
| 9.11–9.12 评测与运维 | 计划 5、6 |
| 10–11 生命周期与一致性 | 计划 2 |
| 12–16 架构、安全、可观测 | 计划 0、1、5、6 |
| 17–20 非功能、质量和错误处理 | 所有计划出口 |
| 21 三阶段路线 | 计划 0–3 对应阶段一；4–5 对应阶段二；6 对应阶段三 |

## 11. 后续详细计划生成规则

- 计划 1 的详细文档在计划 0 出口通过后编写，并引用实际 ORM、迁移和配置文件。
- 计划 2 的详细文档在计划 1 的真实数据模型和任务总线稳定后编写。
- 计划 3 的详细文档在至少三种代表性解析 fixture 可入库后编写。
- 计划 4 的详细文档在文档版本、块和引用 ID 已稳定后编写。
- 计划 5 的详细文档在默认问答评测基线建立后编写。
- 计划 6 的详细文档在前五个计划的资源画像可测量后编写。
- 每份详细计划继续执行 TDD、精确文件路径、完整命令、预期结果和频繁提交规则。
