# Brainstorming Memory

## 产品定位

- 项目是企业内部私有化 RAG 知识平台，不是多租户 SaaS。
- 文档、索引、图谱、记忆、日志和审计留在企业内网；模型能力使用受控云端 API。
- 中文优先，兼容英文和中英混合文档。
- 目标规模为 10 万份文档、500 GB 原文件、1,000 用户、峰值 50 路问答。

## 首期范围

- 本地账号；系统角色只保留管理员和普通成员。
- 空间权限使用 view/edit/manage，文档 ACL 只能在空间权限基础上进一步收紧。
- 支持 PDF、DOCX、DOC、XLSX、XLS、PPTX、PPT、TXT、MD、CSV、JSON 和公开单页 URL。
- 包含扫描 PDF OCR 和 Office 关键图片 OCR。
- URL 首期只抓单页，不做整站、登录态或定时采集。
- Agent 是只读知识 Agent，不访问公网，不执行外部业务写操作。
- 语音采用半双工：流式 ASR、SSE 文本、WebSocket 流式 TTS。

## 架构约束

- React 前端，NestJS 主后端，Python AI 服务。
- NestJS 与 Python 的长任务使用 PostgreSQL Outbox + Redis Streams，不使用仅适合 Node 的任务协议作为跨语言总线。
- PostgreSQL/pgvector + Elasticsearch 提供混合检索，RRF 融合后由 Reranker 精排。
- Neo4j 图谱自动抽取、人工治理，所有关系必须回到文档证据。
- Redis 保存滑动窗口和会话摘要；Mem0 保存用户私有长期记忆和经审核的组织记忆。
- 开发使用 LangGraph Studio，生产使用内网自托管 Langfuse；LangSmith 仅为可选适配。
- 首期只交付 Docker Compose，不承诺节点级高可用。

## 交付与质量

- 采用三阶段交付：文档与混合检索；图谱/Agent/记忆/评测；语音与生产加固。
- 上线前建立不少于 200 个真实问题的评测集。
- 质量基线包括 Recall@10、nDCG@10、引用准确率、答案忠实度和不可回答处理正确率。
- 设计文档在进入实施计划前需要独立审查通过。

