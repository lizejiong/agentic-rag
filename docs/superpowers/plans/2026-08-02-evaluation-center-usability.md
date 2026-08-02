# 评测中心易用性实施计划

> **给 agentic workers：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务逐项执行本计划。步骤使用 checkbox（`- [ ]`）语法跟踪状态。

**目标：** 让管理员第一次使用评测中心就能理解“数据集、题目文件、测试空间、运行”的关系，并能安全地重新导入或删除错误数据。

**架构：** 数据集仍绑定已有知识空间；题目文件只通过明确的“导入题目”操作替换，并在执行前显示会覆盖多少旧题。删除数据集只删除题目和运行记录，不删除绑定空间中的文件，避免误删知识资料。

**技术栈：** NestJS、Prisma/PostgreSQL、React、现有 JSONL 导入接口。

---

### 任务 1：补齐安全的数据集管理接口

**文件：**
- 修改：`apps/api/src/evaluation/evaluation.service.ts`
- 修改：`apps/api/src/evaluation/evaluation.controller.ts`
- 测试：`apps/api/test/evaluation.e2e-spec.ts`

- [ ] **步骤 1：编写删除行为测试**

```ts
await request(app.getHttpServer())
  .delete(`/evaluations/datasets/${datasetId}`)
  .set('Cookie', adminCookie)
  .expect(204);
expect(await prisma.evaluationDataset.findUnique({ where: { id: datasetId } })).toBeNull();
expect(await prisma.knowledgeSpace.findUnique({ where: { id: spaceId } })).not.toBeNull();
```

- [ ] **步骤 2：实现删除与导入预览**

新增 `DELETE /evaluations/datasets/:datasetId`；删除前要求 `MANAGE` 权限。新增 `POST /evaluations/datasets/:datasetId/cases:preview`，复用 JSONL 校验并返回 `{ incomingCaseCount, existingCaseCount }`，不写数据库。

- [ ] **步骤 3：运行接口测试**

Run: `pnpm --filter @rag/api test:e2e -- evaluation.e2e-spec.ts`

预期：删除不会删除空间；错误 JSONL 不修改既有题目。

### 任务 2：重构页面为明确的三步流程

**文件：**
- 修改：`apps/web/src/features/evaluation/evaluation-page.tsx`
- 测试：`apps/web/src/features/evaluation/evaluation-page.spec.tsx`

- [ ] **步骤 1：编写交互测试**

```tsx
await user.click(screen.getByRole('button', { name: '导入或替换题目' }));
await user.upload(screen.getByLabelText('题目 JSONL 文件'), file);
expect(await screen.findByText('将用 25 道题替换当前 20 道题')).toBeInTheDocument();
await user.click(screen.getByRole('button', { name: '确认替换题目' }));
```

- [ ] **步骤 2：实现页面流程**

使用三个清楚的区域：`1. 绑定测试空间`（展示空间、文档数和进入文档管理按钮）、`2. 管理题目`（题目数量、导入/替换、下载示例、确认提示）、`3. 运行评测`。文件选择控件仅在点击“导入或替换题目”后显示，并在选中文件后显示文件名和预览数量。

- [ ] **步骤 3：实现删除确认**

“删除数据集”使用红色危险按钮和二次确认：文案明确“只删除题目和历史结果，不删除知识空间文件”。确认后刷新列表并选择下一个数据集。

- [ ] **步骤 4：运行前端检查**

Run: `pnpm --filter @rag/web typecheck`

预期：类型检查通过。

### 任务 3：验证真实操作路径

**文件：**
- 修改：`services/ai/evals/README.md`

- [ ] **步骤 1：更新操作说明**

将说明改为“创建数据集 → 绑定空间 → 进入空间上传文件 → 导入/替换题目 → 运行”，并说明重新导入只替换题目、删除数据集不删除文件。

- [ ] **步骤 2：执行验证**

Run: `pnpm --filter @rag/api typecheck && pnpm --filter @rag/web typecheck && git diff --check`

预期：接口、页面类型和差异格式均通过。
