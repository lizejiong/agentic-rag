# 中文验收题库与检索评测中心实施计划

> **给 agentic workers：** 必须使用 `superpowers:executing-plans` 按任务逐项执行本计划。步骤使用 checkbox（`- [ ]`）语法跟踪状态。
**目标：** 为虚构互联网公司“星桥云途”提供 20 份中文多格式验收文档、25 道固定问题，以及无需经由聊天即可批量运行和直观检查向量、关键词、RRF、Reranker 全链路结果的评测中心。

**架构：** 测试资料和期望证据作为可提交的固定夹具；运行时导入后产生的内部 UUID 映射与原始报告保持本地。AI 服务在不改变正常聊天返回值的前提下增加可选检索追踪，并提供非流式的 Agent 评测调用；网关只为管理员转发批量评测请求。Web 新增独立 `/evaluation` 页面：左侧选择验收空间和运行，中央显示 25 题的检索和回答质量，通过详情按四阶段展示同一个 chunk 的名次、分数和证据命中状态。

**技术栈：** Python 3.12、FastAPI、NestJS、React、TypeScript、Tailwind/shadcn、`python-docx`、`openpyxl`、`python-pptx`、ReportLab、pytest、Vitest。

---

## 已确认的产品边界

- 数据内容为中文、完全虚构，不包含真实客户或员工信息；企业名称固定为“星桥云途”。
- 首版包含 20 个文件和 25 个固定问题，覆盖 DOCX、PDF、XLSX、PPTX、CSV/TSV；扫描件与图片 OCR 留到后续专项。
- 20 个文件必须全部导入同一个隔离知识空间，空间名称固定为“星桥云途验收空间”；题库、批量运行和报告只针对该空间，避免多个空间的权限和内容干扰检索基线。权限过滤与跨空间检索以后建立独立的专项验收集。
- 不把不稳定的内部 `chunkId` 写进题库。期望证据以“文件标识 + 标题/页码/工作表/唯一短句”标注；导入脚本在当前空间生成本地 `document-map.jsonl`。
- 每次批量运行支持两种模式：**检索诊断**只调用检索和 Reranker，用于快速定位排序问题；**完整验收**在后台调用同一套问答 Agent 生成非流式回答和引用，用于计算回答质量。两种模式都不经由聊天页面或 SSE 接口触发。
- `/evaluation` 仅对 `ADMIN` 显示和可访问；首版结果在当前页面查看并可下载 JSON，长期对比继续按 `docs/evaluation/` 的实验编号保存原始报告。
- 检索层的“准确率”统一命名为**期望证据命中率**：它表示一题标注的正确证据是否出现在某层 Top K；完整验收额外显示**答案要点覆盖率**、**引用证据正确率**和**拒答正确率**。答案要点由独立裁判模型根据题库的 `expectedAnswerPoints` 判定，不能用字符串包含关系冒充语义正确。
- 每次运行同时计算 Vector、ES 关键词、RRF、Reranker 四层的 `Hit@1`、`Hit@5`、`Hit@10`、平均首个证据名次（MRR）和平均耗时；还要显示每个阶段相对前一阶段“新增命中 / 丢失命中”的题数。

## 文件结构

- 新建 `services/ai/evals/fixtures/xingqiao-acceptance/files/`：20 个待上传的真实格式文件。
- 新建 `services/ai/evals/fixtures/xingqiao-acceptance/cases.jsonl`：25 条固定问题及期望证据。
- 新建 `services/ai/evals/fixtures/xingqiao-acceptance/README.md`：文件清单、题型和导入规则。
- 新建 `services/ai/scripts/generate_xingqiao_acceptance_files.py`：幂等生成全部文件，避免二进制文件难以审阅。
- 新建 `services/ai/scripts/import_xingqiao_acceptance.py`：上传文件、等待处理完成、输出本地文档映射。
- 新建 `services/ai/scripts/run_acceptance_evaluation.py`：离线批量运行、写入可复现 JSON 报告。
- 修改 `services/ai/src/rag_ai/retrieval/models.py`：定义可序列化的阶段追踪数据结构。
- 修改 `services/ai/src/rag_ai/retrieval/service.py`：可选收集向量、关键词、RRF 与重排阶段的候选排名和分数。
- 修改 `services/ai/src/rag_ai/routes/search_test.py`：提供单题追踪和 25 题批量评测接口。
- 新建 `apps/api/src/evaluation/evaluation.controller.ts` 与 `evaluation.module.ts`：管理员鉴权、清单读取、批量请求转发。
- 修改 `apps/api/src/app.module.ts`：注册评测模块。
- 新建 `apps/web/src/features/evaluation/evaluation-page.tsx`：批量运行、汇总、题目详情和 JSON 下载。
- 新建 `apps/web/src/features/evaluation/evaluation-page.spec.tsx`：关键交互与排名展示测试。
- 修改 `apps/web/src/app/app-router.tsx`、`apps/web/src/app/pc-app-shell.tsx`：新增管理员专用路由和入口。
- 修改 `docs/evaluation/README.md` 与 `services/ai/evals/README.md`：说明 D003 验收集和运行方法。

### 任务 1：建立可复现的中文验收资料

**文件：**
- 新建 `services/ai/scripts/generate_xingqiao_acceptance_files.py`
- 新建 `services/ai/evals/fixtures/xingqiao-acceptance/cases.jsonl`
- 新建 `services/ai/evals/fixtures/xingqiao-acceptance/README.md`
- 测试 `services/ai/tests/test_xingqiao_acceptance_fixture.py`

- [ ] **步骤 1：先写夹具清单测试。**

```python
def test_acceptance_fixture_contains_twenty_files_and_twenty_five_cases(tmp_path: Path) -> None:
    generate_fixture_files(tmp_path)
    assert len(list(tmp_path.glob("*"))) == 20
    assert len(load_jsonl(CASES_PATH)) == 25
```

- [ ] **步骤 2：运行测试并确认失败。**

运行：`uv run --project services/ai pytest services/ai/tests/test_xingqiao_acceptance_fixture.py -q`

预期：因生成脚本、题库或导入函数不存在而失败。

- [ ] **步骤 3：实现 20 个文件和固定内容。**

文件按“星桥云途”业务场景分布：员工手册、差旅制度（2024 与 2025 版本）、费用标准表、采购流程、信息安全制度、数据分级规范、产品路线图、版本发布说明、客户事故预案、值班手册、项目交接模板、招聘说明、绩效规则、销售折扣政策、合同审批规范、组织通讯录、服务 SLA、研发规范、会议纪要、知识库使用指南。每份文件必须含可定位的标题与唯一证据句；表格题必须标注工作表和单元格范围。

`cases.jsonl` 每行使用以下稳定结构：

```json
{"id":"XQ-001","question":"国内出差住宿标准是多少？","type":"table_lookup","expectedEvidence":[{"document":"expense-standards-2025","anchor":"住宿标准","quote":"一线城市住宿标准为每晚 600 元"}],"expectedAnswerPoints":["一线城市","600 元/晚"],"requiresCitation":true,"expectNoAnswer":false}
```

25 题至少包含 10 道直接事实题、5 道表格题、4 道跨文件题、3 道版本冲突题、2 道无答案拒答题、1 道同义改写题；所有问题都必须由至少一处明确证据判定，不使用主观开放题。每条题目补充 `referenceAnswer`（人工编写的简明参考答案）和 `expectedAnswerPoints`，供完整验收的裁判模型判断要点覆盖。

- [ ] **步骤 4：重新运行夹具测试。**

运行：`uv run --project services/ai pytest services/ai/tests/test_xingqiao_acceptance_fixture.py -q`

预期：通过，且断言 20 个文件、25 个有效 case、每个 case 都有期望证据。

- [ ] **步骤 5：渲染并抽查四种二进制格式。**

运行：`uv run --project services/ai python services/ai/scripts/generate_xingqiao_acceptance_files.py --output services/ai/evals/fixtures/xingqiao-acceptance/files`

预期：DOCX、PDF、XLSX、PPTX 均能由现有解析链路读取，中文不乱码，表格和页码信息存在。

### 任务 2：导入资料并建立动态证据映射

**文件：**
- 新建 `services/ai/scripts/import_xingqiao_acceptance.py`
- 修改 `services/ai/evals/fixtures/xingqiao-acceptance/README.md`
- 测试 `services/ai/tests/test_import_xingqiao_acceptance.py`

- [ ] **步骤 1：写映射输出测试。**

```python
def test_importer_writes_source_slug_to_document_id_map(tmp_path: Path) -> None:
    write_document_map(tmp_path / "document-map.jsonl", {"expense-standards-2025": "uuid"})
    assert load_jsonl(tmp_path / "document-map.jsonl") == [{"sourceDocument":"expense-standards-2025", "documentId":"uuid"}]
```

- [ ] **步骤 2：实现导入器。**

脚本接受 `--space-id`、`--username`、`--password-env` 和 `--document-map-output`；它先校验目标空间名称为“星桥云途验收空间”，再逐一上传全部 `files/`，轮询到“处理完成”或明确失败，并以源文件 slug 写出映射。脚本不得读取或打印密码值，失败时报告对应文件名并以非零状态退出。

- [ ] **步骤 3：用本地测试替身验证超时和失败信息。**

运行：`uv run --project services/ai pytest services/ai/tests/test_import_xingqiao_acceptance.py -q`

预期：成功文件写映射，处理失败文件显示 slug，密码不进入日志。

- [ ] **步骤 4：补充人工运行命令。**

在 README 中写入：创建隔离空间“星桥云途验收空间”，执行导入脚本，确认空间内文件数为 20，保留生成的 `document-map.jsonl`，再到评测中心选择该空间。

### 任务 3：在检索层保留四阶段候选追踪

**文件：**
- 修改 `services/ai/src/rag_ai/retrieval/models.py`
- 修改 `services/ai/src/rag_ai/retrieval/service.py`
- 修改 `services/ai/tests/test_retrieval.py`

- [ ] **步骤 1：先定义失败测试。**

```python
@pytest.mark.asyncio
async def test_retrieve_with_trace_preserves_vector_lexical_rrf_and_rerank_ranks() -> None:
    result = await service.retrieve_with_trace("差旅住宿标准", [space_id], acl, policies)
    assert result.trace.vector[0].rank == 1
    assert result.trace.lexical[0].rank == 1
    assert result.trace.rrf[0].rrf_score is not None
    assert result.trace.rerank[0].rerank_score is not None
```

- [ ] **步骤 2：实现只读追踪模型与方法。**

新增 `RetrievalTraceItem`（chunk、rank、原始 score、vectorRank、lexicalRank、rrfScore、rerankScore）和 `RetrievalTrace`（`vector`、`lexical`、`rrf`、`rerank`）。`retrieve()` 保持现有签名和聊天行为；新增 `retrieve_with_trace()` 复用同一内部流程，确保追踪和最终回答使用完全相同的候选集合。RRF 阶段必须保留两个来源名次，重排阶段只包含实际发送给 reranker 的候选，并记录无 reranker 或降级时的原因。

- [ ] **步骤 3：运行检索单测。**

运行：`uv run --project services/ai pytest services/ai/tests/test_retrieval.py -q`

预期：既有 ACL/禁用向量测试保持通过，新测试验证同一 chunk 在四层中的排名与分数。

### 任务 4：提供管理员批量评测 API

**文件：**
- 修改 `services/ai/src/rag_ai/routes/search_test.py`
- 新建 `apps/api/src/evaluation/evaluation.controller.ts`
- 新建 `apps/api/src/evaluation/evaluation.module.ts`
- 修改 `apps/api/src/app.module.ts`
- 测试 `services/ai/tests/test_search_test.py`
- 测试 `apps/api/src/evaluation/evaluation.controller.spec.ts`

- [ ] **步骤 1：为 AI 路由写 trace 响应测试。**

```python
async def test_batch_evaluation_returns_case_status_and_trace(client: AsyncClient) -> None:
    response = await client.post("/v1/retrieval/evaluate", json={"cases": [case], **request_context})
    assert response.json()["results"][0]["trace"]["rrf"]
```

- [ ] **步骤 2：实现 AI 的批量接口。**

`POST /v1/retrieval/evaluate` 接收最多 25 个 `{id, question, expectedEvidence, referenceAnswer, expectedAnswerPoints, expectNoAnswer}` 和 `mode`（`retrieval` 或 `full`），共享一次 ACL 和空间策略。每题调用 `retrieve_with_trace()`，按期望文档和证据短句计算每个阶段的 `hitAt1`、`hitAt5`、`hitAt10`、`firstExpectedRank` 与 `mrr`；`full` 模式额外调用非流式 Agent 生成回答、收集引用，并调用配置的裁判模型返回 `answerPointCoverage`、`citationEvidencePrecision`、`citationEvidenceRecall` 与 `refusalCorrect`。裁判输入仅含题目、参考答案、要点、实际回答和引用片段；批次结果汇总四阶段的命中率、MRR、回答质量、平均耗时、相邻阶段新增/丢失命中题数，以及每题耗时和总耗时。

- [ ] **步骤 3：实现 Nest 管理员网关。**

`GET /evaluations/datasets/xingqiao-acceptance` 返回服务端内置的 25 题清单和唯一目标空间名；`POST /evaluations/runs` 验证 `spaceId`、空间名称、`mode`、管理员角色和 25 题上限，验证管理员有空间 `VIEW` 权限后转发到 AI 服务。目标空间不是“星桥云途验收空间”时拒绝运行，防止误将验收题跑到业务空间。完整验收的网关超时设为 300 秒，检索诊断保持 120 秒；均返回明确的 `EVALUATION_TIMEOUT`，不能无限等待。

- [ ] **步骤 4：运行接口测试。**

运行：`uv run --project services/ai pytest services/ai/tests/test_search_test.py -q` 和 `pnpm --filter @atlas/api test -- evaluation.controller.spec.ts`

预期：普通成员为 403、无空间权限为 403、超时为可读错误、每题均有四阶段追踪。

### 任务 5：实现评测中心页面

**文件：**
- 新建 `apps/web/src/features/evaluation/evaluation-page.tsx`
- 新建 `apps/web/src/features/evaluation/evaluation-page.spec.tsx`
- 修改 `apps/web/src/app/app-router.tsx`
- 修改 `apps/web/src/app/pc-app-shell.tsx`

- [ ] **步骤 1：写页面行为测试。**

```tsx
it('shows a pass summary and every retrieval stage for an expanded case', async () => {
  render(<EvaluationPage />);
  await userEvent.click(screen.getByRole('button', { name: '运行 25 题' }));
  expect(await screen.findByText('22 / 25 命中期望证据')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '查看 XQ-001 详情' }));
  expect(screen.getByText('向量检索')).toBeInTheDocument();
  expect(screen.getByText('关键词检索')).toBeInTheDocument();
  expect(screen.getByText('RRF 融合')).toBeInTheDocument();
  expect(screen.getByText('Reranker 重排')).toBeInTheDocument();
});
```

- [ ] **步骤 2：实现管理员入口与页面信息层级。**

管理员导航新增“评测中心”；非管理员不显示入口且路由重定向到工作台。页面上方只保留验收集名称、只读的“星桥云途验收空间”状态、运行模式（默认“完整验收”）、`运行 25 题` 和 `下载本次 JSON`；未创建或无权访问该空间时显示明确的准备指引。运行区先显示“最终 Reranker 期望证据命中率（Top 10）”、**答案要点覆盖率**、**引用证据正确率**、**拒答正确率**和平均耗时；紧接着以四列展示 Vector、ES 关键词、RRF、Reranker 各自的 `Hit@1 / Hit@5 / Hit@10 / MRR`。再显示三个变化卡片：关键词→RRF、RRF→Reranker 的新增命中题数和丢失命中题数。下方表格按题目展示问题、生成回答、参考答案、要点覆盖、引用证据、各阶段首个命中名次、最终状态和“查看详情”。

- [ ] **步骤 3：实现单题四阶段视图。**

展开题目后先显示生成回答、引用和裁判结论，再使用四列（窄屏不适配是允许的，项目以 PC 为先）：向量检索、关键词检索、RRF 融合、Reranker 重排。每张 chunk 卡显示名次、分数、文档名、页码/工作表、前 300 字文本；期望证据用绿色标记。缺席某阶段显示“未进入此阶段”，而不是隐藏。重排列额外显示模型名、版本和降级原因；完整验收额外显示回答模型和裁判模型版本。

- [ ] **步骤 4：实现运行状态与下载。**

按钮运行时显示当前题号、禁用重复点击；网络失败显示后端给出的超时或服务不可用信息，并保留上一次成功结果。下载文件名使用 `E###-xingqiao-acceptance-YYYYMMDD-HHmmss.json`，内容即后端结构化响应，方便放入 `services/ai/evals/cases/` 供复盘。

- [ ] **步骤 5：运行前端验证。**

运行：`pnpm --filter @atlas/web test -- evaluation-page.spec.tsx`、`pnpm --filter @atlas/web typecheck`、`pnpm --filter @atlas/web lint`

预期：测试、类型检查与 lint 通过；普通用户没有评测入口。

### 任务 6：补齐离线运行与文档、完成端到端验证

**文件：**
- 新建 `services/ai/scripts/run_acceptance_evaluation.py`
- 修改 `services/ai/evals/README.md`
- 修改 `docs/evaluation/README.md`
- 测试 `services/ai/tests/test_run_acceptance_evaluation.py`

- [ ] **步骤 1：实现 CLI 报告导出。**

脚本读取固定 `cases.jsonl`、动态 document map、空间 ID 和用户 ID，调用同一个批量检索接口，并将原始响应写为 JSON。它不启动聊天、不调用 LLM，返回非零状态仅用于请求失败；检索命中不达标仍写报告，以便分析。

- [ ] **步骤 2：添加 D003 数据集说明。**

在 `docs/evaluation/README.md` 将“星桥云途中文验收集”登记为 D003，明确它用于产品验收和故障定位，不与英文 SciFact 分数混合比较。新增实验记录格式：测试空间、模型配置、文件版本、25 题总命中率、四阶段命中率、失败题编号和采取的改动。

- [ ] **步骤 3：运行完整验证。**

运行：

```powershell
uv run --project services/ai ruff check services/ai
uv run --project services/ai mypy services/ai/src
uv run --project services/ai pytest services/ai/tests -q
pnpm --filter @atlas/api test
pnpm --filter @atlas/web test
pnpm --filter @atlas/web typecheck
```

预期：全部通过。随后创建隔离空间，导入 20 个文件，在 `/evaluation` 跑完 25 题，确认每一题都可展开为四阶段结果，JSON 下载可被 CLI 读取。

## 自查

- 20 个中文、虚构、多格式文件与 25 题由任务 1 覆盖。
- 不经聊天、批量运行与每题状态由任务 4、5 覆盖。
- 向量、关键词、RRF、重排候选、排序变化和各阶段 `Hit@K/MRR/耗时/增减题数` 由任务 3、4、5 覆盖。
- 动态 chunk/document 映射避免导入后 UUID 变化导致题库失效，由任务 2 覆盖。
- 回答要点、引用和拒答质量的非流式 Agent 评测及独立裁判由任务 4、5 覆盖。
- 可复盘 JSON 和统一实验记录由任务 5、6 覆盖。
