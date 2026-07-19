# Phase 1 依赖与目录决策

状态：Accepted  
日期：2026-07-19  
范围：本地数据平台、身份、权限、审计和异步事件

## 背景

PRD 已经确定 PostgreSQL/pgvector、Elasticsearch、Neo4j、Redis、MinIO、NestJS 和 Python 等边界，但“确定能力边界”不等于“所有库和目录不可调整”。Phase 1 会先判断成熟开源库是否能降低安全风险和长期维护成本，同时避免为了使用库而扭曲跨语言架构。

本次决策参考了以下活跃项目和官方实践：

- [Dify](https://github.com/langgenius/dify) 将本地中间件 Compose 与应用开发进程分开，并把核心环境变量与高级配置分层。
- [RAGFlow](https://github.com/infiniflow/ragflow) 集中管理 Elasticsearch、MinIO、Redis 等依赖的版本、资源限制和健康检查。
- [Onyx](https://github.com/onyx-dot-app/onyx) 按业务能力组织后端代码，并集中约束 RBAC、密钥、参数化查询和模型 Trace。
- [Prisma NestJS 指南](https://docs.prisma.io/docs/guides/frameworks/nestjs) 使用可注入的 Prisma service 管理连接。
- [Redis Streams 文档](https://redis.io/docs/latest/develop/data-types/streams/) 明确 consumer group、pending entries 和显式 ACK 的投递语义。

参考项目用于验证结构和运行边界，不复制其特定框架、云服务或历史兼容层。

## 目录结构

继续使用当前 pnpm monorepo：

```text
apps/
├── api/                    NestJS 对外业务 API 和协议网关
└── web/                    React 用户端与管理端
packages/
└── contracts/              跨进程和前端可见的稳定 TypeScript 契约
services/
└── ai/                     Python 解析、检索、Agent、图谱和模型适配
infra/
└── compose/                本地与私有化部署中间件
```

理由：

- 当前四个工程边界分别对应独立部署进程，职责清晰，拆仓只会增加契约发布和版本协调成本。
- `packages/contracts` 只保存真正跨边界的协议，不共享 Prisma model、NestJS service 或 Python 内部类型。
- Compose 配置独立放在 `infra/compose`，避免根目录和业务应用目录被部署细节淹没。

NestJS 采用 feature-first：

```text
apps/api/src/
├── auth/
├── authorization/
├── audit/
├── organization/
├── spaces/
├── outbox/
└── infrastructure/
    ├── config/
    ├── database/
    └── redis/
```

每个 feature 持有自己的 controller、service、DTO 和测试。数据库连接、Redis 连接和配置解析放入 `infrastructure`，但业务查询和授权规则仍由 feature 持有。禁止创建无限增长的 `common/services`、`utils` 或全局 repository 文件。

## 库选择

### Prisma ORM：采用

- 用途：NestJS 管理 PostgreSQL `app` schema、关系模型、事务和迁移。
- 原因：Phase 1 包含用户、组织、空间、ACL、refresh session、审计和 Outbox 等强关系模型；Prisma 的类型生成和迁移能减少手写映射错误，并有官方 NestJS 和 PostgreSQL multi-schema 文档。
- 边界：后续 pgvector、RRF 或复杂授权过滤允许使用参数化原生 SQL；检索实现不必迁就 ORM。
- 退出策略：migration SQL 是仓库资产；业务代码通过 feature service 使用 Prisma，禁止 controller 直接依赖生成类型。必要时可逐 feature 换成 Kysely/SQL repository。
- 许可证：[Apache-2.0](https://github.com/prisma/prisma)。

未采用 TypeORM：decorator entity 和运行时 metadata 对本项目没有额外收益，迁移与数据库真实状态更容易漂移。  
未采用 Drizzle：SQL-first 和轻量是优点，但本阶段 Prisma 的迁移生态、关系类型和官方 NestJS 示例更成熟；复杂 SQL 仍可从 Prisma 逃生。

### `argon2`：采用

- 用途：本地账号密码 Argon2id 哈希和验证。
- 原因：符合 PRD 的强哈希要求，避免自实现密码 KDF。
- 边界：参数集中配置并记录版本；禁止在 controller 直接调用。
- 退出策略：密码 hash 自带算法和参数，可在成功登录后渐进升级或迁移实现。
- 许可证：MIT；发布前由依赖许可证扫描再次确认实际锁定版本。

### `@nestjs/jwt`：采用

- 用途：短期 access token 签发和验证。
- 原因：与 NestJS guard/DI 生命周期匹配，减少自写 JOSE 解析错误。
- 边界：refresh token 使用随机不透明 token，数据库只保存 SHA-256 hash，不把长期会话塞进 JWT。
- 退出策略：JWT claims 由项目内 `AuthenticatedUser` 契约隔离，可替换为 `jose` 或外部 OIDC。
- 许可证：MIT；发布前由依赖许可证扫描确认锁定版本。

未采用 Passport：当前只有一种 Bearer JWT 策略，直接 guard 更短、更明确；出现 LDAP/OIDC 多策略后再评估。  
未采用 Keycloak：它提供完整身份联盟和细粒度授权，但首期只要求本地账号与两种系统角色，引入独立身份服务会增加部署、用户同步和故障边界。[Keycloak](https://github.com/keycloak/keycloak) 为 Apache-2.0，可作为后续 LDAP/OIDC 阶段候选。

### 官方 `redis` Node client：采用

- 用途：登录限流、authorization snapshot 缓存、Redis Streams 发布和消费。
- 原因：官方维护、支持 Streams，接口足以实现 `XADD`、`XREADGROUP`、`XACK` 和 `XAUTOCLAIM`。
- 边界：阻塞式 consumer 使用独立连接，不能与 HTTP 请求缓存操作共享连接；永久业务状态只能写 PostgreSQL。
- 退出策略：封装在 `infrastructure/redis`，业务层依赖窄接口。服务端保留 Redis 协议兼容，可评估 Valkey。
- 客户端许可证：[MIT](https://github.com/redis/node-redis)。

Redis Server 8 可选择 AGPLv3/RSALv2/SSPLv1，私有化交付前必须由法务确认分发方式；如企业政策要求宽松许可证，优先验证 Valkey 兼容性，业务协议不变。

### BullMQ：暂不采用

- 优点：成熟的延迟任务、重试、并发、去重和可视化生态，项目为 [MIT](https://github.com/taskforcesh/bullmq)。
- 不采用原因：PRD 明确 NestJS 和 Python 共用 PostgreSQL Outbox + Redis Streams。BullMQ 的 Node 抽象会让 Python 消费者依赖其内部协议，削弱跨语言可审计性。
- 重新评估条件：出现仅由 Node 消费、无需跨语言或 PostgreSQL 真相源的短生命周期任务。

### Testcontainers：按需采用

- 用途：在数据库/Redis 集成测试需要隔离且 CI 服务容器无法覆盖时启动临时依赖。
- 当前决策：Phase 1 首先使用统一 Compose 和 CI service containers，避免 Windows/Docker Desktop 上每个测试文件重复拉起容器。
- 重新评估条件：并行测试发生状态互扰，或需要验证多个 PostgreSQL/Redis 版本。
- 退出策略：测试 fixture 只接收连接 URL，不依赖 Testcontainers 类型。
- 许可证：MIT；引入时由依赖许可证扫描确认锁定版本。

## 数据和迁移边界

- NestJS/Prisma 只管理 PostgreSQL `app` schema。
- Python/Alembic 只管理 `rag` schema，并在该 schema 保存自己的 migration history。
- PostgreSQL 保存用户、授权、任务、审计和 Outbox 真相；Redis 清空只能造成缓存 miss 和消息重放，不能丢永久业务状态。
- 所有授权变更在同一 PostgreSQL 事务中更新业务数据、递增 `authorization_revision`、写审计和 Outbox。
- Streams 使用 at-least-once 语义；消费者以 event ID 幂等，处理成功后显式 ACK。

## 角色与授权复杂度

第一版只保留两个系统角色：

- `ADMIN`
- `MEMBER`

`VIEW`、`EDIT`、`MANAGE` 是知识空间资源上的递进权限，不是额外系统角色。部门和用户组只是授权主体集合，不引入岗位、职级、策略语言或显式 deny。文档 ACL 只能在已有空间 `VIEW` 的基础上进一步收紧。

## 变更门禁

新增基础库前必须回答：

1. 它是否替代了高风险或高维护成本的自研代码？
2. 维护是否活跃，许可证是否允许目标私有化交付？
3. 是否同时适配 Windows 开发、Linux Compose 和目标 CPU 架构？
4. 是否把业务数据锁入专有格式，退出路径是什么？
5. 是否跨越 NestJS/Python/浏览器的既有信任边界？

若答案不足以证明收益，先使用已有能力或项目内窄接口，不为“技术栈完整”增加依赖。

## 实施期复核机制

ADR 中的库选择是当前默认方案，不是不可变清单。进入解析、检索、图谱、记忆、Agent、语音和可观测性等新能力前，先做一次轻量复核：

1. 明确本次能力的真实复杂度、性能目标和失败边界，再比较项目内实现与成熟开源库；
2. 优先查阅官方文档，并选择 2–3 个同类活跃开源项目核对依赖、模块边界和部署方式；
3. 只有在安全性、正确性、兼容性或维护成本上有明确收益时才新增库，不因 PRD 曾列出或社区流行而强制采用；
4. 新库通过项目内端口或适配器隔离，业务模型不直接依赖第三方对象，保留替换和降级路径；
5. 每完成一个阶段检查一次目录：业务代码仍按 feature 聚合，跨进程契约仍集中在 `packages/contracts`，基础设施代码没有侵入业务模块。

复核结果若改变已接受决策，应更新本 ADR 或新增 ADR；不改变决策时只需在实现计划或提交说明中记录结论，避免形成重型评审流程。
