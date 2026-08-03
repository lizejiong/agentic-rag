# 数据库化评测中心实施计划

> **给 agentic workers：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务逐项执行本计划。步骤使用 checkbox（`- [ ]`）语法跟踪状态。

**目标：** 将评测题库、知识空间绑定、问题、期望证据和每次批量运行结果保存到数据库，使管理员无需修改代码即可创建、运行和复盘多个评测数据集。

**架构：** 评测数据集只保存测试定义并绑定一个已有知识空间；测试文件仍通过现有“知识空间 → 文档列表”上传、解析和索引，不复制文档功能。NestJS 负责管理员权限、数据库持久化和调用 Python AI 服务；Python 服务继续执行真实 Agent 链路并返回诊断结果，不保存业务数据。

**技术栈：** Prisma/PostgreSQL、NestJS、React + TanStack Query、现有 `/v1/retrieval/evaluate`、`pnpm db:migrate:app`、`pnpm typecheck`、`uv run --project services/ai pytest`。

---

### 任务 1：建立评测领域数据模型

**文件：**
- 修改：`apps/api/prisma/schema.prisma`
- 新建：`apps/api/prisma/migrations/<timestamp>_add_evaluation_center/migration.sql`
- 修改：`apps/api/prisma/seed.ts`
- 测试：`apps/api/test/evaluation.e2e-spec.ts`

- [ ] **步骤 1：编写数据库行为测试**

在 `apps/api/test/evaluation.e2e-spec.ts` 建立管理员和一个知识空间；调用创建数据集接口后断言响应包含 `id`、`spaceId`、`caseCount: 0`，并用 Prisma 查询确认数据集的 `createdById` 和 `spaceId` 正确。

```ts
const created = await request(app.getHttpServer())
  .post('/evaluations/datasets')
  .set('Cookie', adminCookie)
  .send({ name: '客服验收 V1', spaceId })
  .expect(201);

expect(created.body).toMatchObject({ name: '客服验收 V1', spaceId, caseCount: 0 });
expect(await prisma.evaluationDataset.findUniqueOrThrow({ where: { id: created.body.id } }))
  .toMatchObject({ createdById: adminId, spaceId });
```

- [ ] **步骤 2：运行测试，确认接口尚不存在**

Run: `pnpm --filter @rag/api test:e2e -- evaluation.e2e-spec.ts`

预期：失败，错误为 `404` 或 Prisma 模型不存在。

- [ ] **步骤 3：在 Prisma 定义四个模型**

在 `apps/api/prisma/schema.prisma` 增加：

```prisma
model EvaluationDataset {
  id          String          @id @default(uuid()) @db.Uuid
  name        String          @db.VarChar(160)
  description String?
  spaceId     String          @map("space_id") @db.Uuid
  createdById String          @map("created_by_id") @db.Uuid
  createdAt   DateTime        @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt   DateTime        @updatedAt @map("updated_at") @db.Timestamptz(3)
  space       KnowledgeSpace  @relation(fields: [spaceId], references: [id], onDelete: Restrict)
  createdBy   User            @relation(fields: [createdById], references: [id], onDelete: Restrict)
  cases       EvaluationCase[]
  runs        EvaluationRun[]
  @@index([spaceId])
  @@index([createdById])
  @@map("evaluation_datasets")
  @@schema("app")
}
```

同时定义：`EvaluationCase`（题目、排序、参考答案、`expectedEvidence Json`、`expectedAnswerPoints String[]`、`expectNoAnswer`）、`EvaluationRun`（数据集、运行模式、状态、摘要 JSON、开始/结束时间）和 `EvaluationRunResult`（题目快照、检索轨迹 JSON、回答、引用 JSON、四项分数、错误和耗时）。为 `KnowledgeSpace`、`User` 添加反向关系。

- [ ] **步骤 4：生成迁移和 Prisma Client**

Run: `pnpm --filter @rag/api exec prisma migrate dev --name add_evaluation_center`

预期：生成一个只创建 `app.evaluation_*` 表、索引和外键的迁移；随后运行 `pnpm prepare:generated`。

- [ ] **步骤 5：运行数据库行为测试**

Run: `pnpm --filter @rag/api test:e2e -- evaluation.e2e-spec.ts`

预期：创建数据集测试通过。

### 任务 2：实现管理员数据集与题目接口

**文件：**
- 新建：`apps/api/src/evaluation/evaluation.service.ts`
- 修改：`apps/api/src/evaluation/evaluation.controller.ts`
- 修改：`apps/api/src/evaluation/evaluation.module.ts`
- 测试：`apps/api/test/evaluation.e2e-spec.ts`

- [ ] **步骤 1：编写接口失败测试**

覆盖以下行为：非管理员访问返回 `403`；管理员绑定无管理权限空间返回 `403`；JSONL 中某一行缺少 `expectedEvidence` 返回 `400` 且不写入任何题目。

```ts
await request(app.getHttpServer())
  .post(`/evaluations/datasets/${datasetId}/cases:import`)
  .set('Cookie', adminCookie)
  .send({ format: 'jsonl', content: '{"question":"缺少字段"}' })
  .expect(400);
expect(await prisma.evaluationCase.count({ where: { datasetId } })).toBe(0);
```

- [ ] **步骤 2：实现 `EvaluationService`**

实现下列方法，并始终先调用 `SpacePolicy.require(user, spaceId, 'MANAGE')`：

```ts
createDataset(user, { name, description, spaceId })
listDatasets(user)
getDataset(user, datasetId)
replaceCasesFromJsonl(user, datasetId, content)
```

`replaceCasesFromJsonl` 使用 Zod 校验每一行，并在同一个 Prisma transaction 中删除旧题、按输入行号写入新题；若任一行不合法，transaction 回滚。第一版明确只支持 JSONL，CSV 导入放到后续迭代，避免用不可靠的手写 CSV 解析器。

- [ ] **步骤 3：提供 REST 路由**

在 `EvaluationController` 提供：

```text
GET    /evaluations/datasets
POST   /evaluations/datasets
GET    /evaluations/datasets/:datasetId
POST   /evaluations/datasets/:datasetId/cases:import
```

删除当前读取 `services/ai/evals/fixtures`、`dataset.json` 和 `cases.jsonl` 的代码；保留 Python `/v1/retrieval/evaluate` 协议中的题目数组。

- [ ] **步骤 4：运行接口测试**

Run: `pnpm --filter @rag/api test:e2e -- evaluation.e2e-spec.ts`

预期：创建、列表、导入、非法 JSONL 回滚和权限拒绝全部通过。

### 任务 3：持久化批量运行和单题结果

**文件：**
- 修改：`apps/api/src/evaluation/evaluation.service.ts`
- 修改：`apps/api/src/evaluation/evaluation.controller.ts`
- 测试：`apps/api/test/evaluation.e2e-spec.ts`

- [ ] **步骤 1：编写运行记录测试**

用 mock `fetch` 返回一个包含成功题和失败题的 Python 评测响应；断言一次 `POST /evaluations/datasets/:datasetId/runs` 创建一个 `EvaluationRun` 和对应数量的 `EvaluationRunResult`，并保存 `effectiveQuery`、`trace`、`answer`、`error`。

```ts
expect(await prisma.evaluationRun.count({ where: { datasetId } })).toBe(1);
expect(await prisma.evaluationRunResult.count({ where: { runId } })).toBe(2);
expect(savedResult.trace).toEqual(expect.objectContaining({ rerank: expect.any(Array) }));
```

- [ ] **步骤 2：实现保存前后的运行状态**

调用 AI 服务前创建 `RUNNING` 的 `EvaluationRun`；成功后在 transaction 中写入结果、summary 和 `COMPLETED`；请求异常则标记 `FAILED` 并保存安全的错误摘要。运行请求只从数据库读取题目，不接受浏览器传入的题目、ACL 或空间 ID。

- [ ] **步骤 3：添加运行和历史接口**

```text
POST /evaluations/datasets/:datasetId/runs
GET  /evaluations/datasets/:datasetId/runs
GET  /evaluations/runs/:runId
```

列表按 `createdAt desc` 返回最近 20 次运行，详情返回逐题轨迹和指标。所有接口仅允许管理员，且必须对绑定空间有 `MANAGE` 权限。

- [ ] **步骤 4：运行持久化测试**

Run: `pnpm --filter @rag/api test:e2e -- evaluation.e2e-spec.ts`

预期：运行状态、结果快照、失败状态和历史排序测试通过。

### 任务 4：改造评测中心前端

**文件：**
- 修改：`apps/web/src/features/evaluation/evaluation-page.tsx`
- 新建：`apps/web/src/features/evaluation/evaluation-api.ts`
- 新建：`apps/web/src/features/evaluation/evaluation-contract.ts`
- 测试：`apps/web/src/features/evaluation/evaluation-page.spec.tsx`

- [ ] **步骤 1：编写页面行为测试**

mock 数据集列表与详情；断言管理员能创建数据集、选择绑定空间、导入 JSONL 文件，运行完成后列表显示历史记录和本次结果。

```tsx
await user.click(screen.getByRole('button', { name: '新建数据集' }));
await user.type(screen.getByLabelText('数据集名称'), '客服验收 V1');
await user.selectOptions(screen.getByLabelText('测试空间'), spaceId);
await user.click(screen.getByRole('button', { name: '创建' }));
expect(await screen.findByText('客服验收 V1')).toBeInTheDocument();
```

- [ ] **步骤 2：定义前端契约和 API 函数**

在 `evaluation-contract.ts` 用 Zod 定义 `EvaluationDataset`、`EvaluationCase`、`EvaluationRun` 和 `EvaluationRunResult`；在 `evaluation-api.ts` 实现 `listDatasets`、`createDataset`、`importCases`、`startRun`、`listRuns`、`getRun`，全部通过现有 `requestJson`。

- [ ] **步骤 3：实现第一版页面流程**

页面包含三个区域：数据集列表与“新建数据集”对话框；所选数据集的绑定空间、文档入口和 JSONL 导入；最近运行列表与选中运行的指标/逐题详情。文档入口链接到 `/spaces/:spaceId/documents`，继续复用已有上传页面。

- [ ] **步骤 4：运行前端测试和类型检查**

Run: `pnpm --filter @rag/web test -- evaluation-page.spec.tsx && pnpm --filter @rag/web typecheck`

预期：页面交互测试和 TypeScript 检查通过。

### 任务 5：迁移现有星桥云途验收集并更新文档

**文件：**
- 新建：`apps/api/prisma/seed-evaluation.ts`
- 修改：`apps/api/prisma/seed.ts`
- 修改：`docs/evaluation/README.md`
- 修改：`services/ai/evals/README.md`
- 删除：`services/ai/evals/fixtures/xingqiao-acceptance/dataset.json`
- 保留：`services/ai/evals/fixtures/xingqiao-acceptance/cases.jsonl`

- [ ] **步骤 1：编写幂等导入测试**

运行两次 seed helper，断言只存在一个名称为“星桥云途验收集”的数据集，且题目数量为 25。

```ts
await seedEvaluationDataset(prisma, adminId, spaceId);
await seedEvaluationDataset(prisma, adminId, spaceId);
expect(await prisma.evaluationDataset.count({ where: { name: '星桥云途验收集' } })).toBe(1);
expect(await prisma.evaluationCase.count({ where: { dataset: { name: '星桥云途验收集' } } })).toBe(25);
```

- [ ] **步骤 2：实现可选的 seed helper**

仅当环境变量 `EVALUATION_SEED_SPACE_ID` 指向存在空间时导入现有 JSONL；默认 seed 不创建或猜测知识空间，避免污染普通开发环境。导入逻辑复用任务 2 的 JSONL 解析函数。

- [ ] **步骤 3：更新操作文档**

文档改为：先在评测中心新建数据集并绑定隔离空间，再从页面导入 `cases.jsonl`，随后在该空间上传 `files/` 内文件；每次运行自动保存，可在运行历史比较结果。删除“代码目录自动发现题库”的说明。

- [ ] **步骤 4：执行完整验证**

Run: `pnpm prepare:generated && pnpm --filter @rag/api typecheck && pnpm --filter @rag/web typecheck && pnpm --filter @rag/api test:e2e -- evaluation.e2e-spec.ts && uv run --project services/ai pytest services/ai/tests/test_agent.py -q`

预期：Prisma Client、API、前端和既有 Agent 回归测试全部通过。

## 自检

- 覆盖：数据集创建、空间绑定、JSONL 导入、真实 Agent 批跑、运行历史与星桥云途迁移均有对应任务。
- 边界：第一版复用既有文档上传，不新建文件存储或导入管道；第一版只接受 JSONL，CSV 放到独立后续任务。
- 一致性：浏览器只传数据集 ID；API 从数据库读取空间、题目和管理员 ACL；Python 服务不拥有评测数据表。
