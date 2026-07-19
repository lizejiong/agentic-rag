# 001：服务边界与信任模型

状态：已接受（Plan 0）

## 决策

系统采用浏览器、NestJS API 与 Python AI 服务三层边界。

| 组件 | 对外职责 | 不承担的职责 |
| --- | --- | --- |
| React Web | 展示消息、状态和安全引用；发起流式问答与停止操作 | 不直接访问 Python、存储、模型或内部检索服务 |
| NestJS API | 身份与租户上下文、ACL、请求校验、引用重新鉴权、外部流协议 | 不承载 Agent 推理与检索实现 |
| Python AI | Agent 编排、检索/图谱工具调用、事件生成 | 不接受浏览器公开调用，不决定最终外部授权 |

浏览器只访问 NestJS。Python AI 服务仅接受来自 NestJS 的内部调用；部署时必须通过网络策略、服务身份或等价机制落实这一限制，不能只依赖“未公开 URL”。

## 协议所有权

- 浏览器到 NestJS：AI SDK UI Message Stream（SSE），当前协议版本为 `1`。
- NestJS 到 Python：`application/x-ndjson`，每行一个严格校验的 `AgentEvent`。
- NestJS 是身份、ACL、引用重新鉴权和外部协议的真相源。
- Python 可以返回内部证据标识，但浏览器引用只允许输出 `citationId`、`title`、`snippet` 和安全位置字段。
- ACL、用户/组标识、MinIO 对象键、存储桶名、内部 URL、签名直链和模型思维链不得进入浏览器流。

## 身份占位的退出条件

Plan 0 中的 `foundation-user` 只是验证服务边界的骨架身份，不能用于生产。

Plan 1 的第一个身份接入测试必须证明：

1. NestJS 从已验证的登录主体构造 `actorId`，不接受浏览器自报身份。
2. 租户与知识空间权限在检索前生效。
3. citation 返回浏览器前由 NestJS 依据当前主体重新鉴权。
4. 未授权文档既不能进入答案，也不能通过引用元数据侧漏。

在这些测试通过前，系统不得被描述为具备生产级多租户权限隔离。

## 原因

该边界让 Python 专注 Agentic RAG，把易变的模型/检索编排与稳定的外部身份和协议分开；同时确保浏览器永远无法绕过 NestJS 的授权与审计层。
