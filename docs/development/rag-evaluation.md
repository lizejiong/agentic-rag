# RAG 量化评测

Phase 3 使用两层评测：基础门禁使用确定性指标，真实模型评审作为离线补充。

## 基础门禁

每个评测样本必须记录问题、相关 chunk ID、实际检索排序和回答引用 ID。报告包含以下指标：

- `Recall@10`：前 10 个结果覆盖相关 chunk 的比例，门槛 `>= 0.85`。
- `nDCG@10`：相关 chunk 排序质量，门槛 `>= 0.75`。
- `Citation precision`：回答引用中有对应证据的比例，门槛 `>= 0.95`。

`rag_ai.evaluation.metrics` 提供这三个可复现、无外部模型依赖的计算函数；任一门槛失败均应使出口检查失败。缺少带引用的样本同样失败，避免只评检索而遗漏可验证回答。

## 输入格式

评测程序读取 JSONL：每行一个固定测试集问题的实际运行结果。

```json
{
  "id": "question-001",
  "retrievedChunkIds": ["chunk-a", "chunk-b"],
  "relevantChunkIds": ["chunk-a"],
  "citationIds": ["chunk-a"],
  "supportedCitationIds": ["chunk-a"]
}
```

`relevantChunkIds` 与 `supportedCitationIds` 由人工标注；`retrievedChunkIds` 和 `citationIds` 必须来自待验收版本的真实运行结果。

## 运行

```powershell
uv run --project services/ai python services/ai/scripts/evaluate_retrieval.py --input services/ai/evals/fixtures/example-results.jsonl
```

可通过 `--report reports/phase3.json` 保存报告；也可用 `--min-recall`、`--min-ndcg`、`--min-citation` 临时调整门槛。`example-results.jsonl` 仅用于验证工具链，不能作为 Phase 3 的验收证据。

## 数据集要求

- 使用已发布文档的稳定 chunk ID 或 fixture 中的逻辑 ID。
- 每个问题至少标注一个相关 chunk；ACL 撤权和证据不足样例必须单独覆盖。
- 评测集、检索输出和报告均提交版本控制；真实凭据和生产文档不得提交。

## 社区参考

- [Ragas metrics](https://docs.ragas.io/en/latest/concepts/metrics/available_metrics/)：适合增加离线 LLM-as-a-judge 补充指标。
- [DeepEval RAG evaluation](https://github.com/confident-ai/deepeval/blob/main/docs/guides/guides-rag-evaluation.mdx)：提供上下文、答案质量指标与 CI 集成示例。
- [TruLens RAG templates](https://www.trulens.org/reference/trulens/feedback/templates/rag/)：提供 groundedness 与 context relevance 模板。

## Phase 3 出口检查

1. 固定并版本化覆盖真实知识库的问题集与人工标注。
2. 用候选版本运行检索和问答，将真实分块 ID、引用 ID 导出为 JSONL。
3. 运行评测脚本，保存 JSON 报告和输入数据版本。
4. 三项指标均达到门槛后，记录在路线图的出口检查中；否则按失败样本优化召回、重排或引用生成。

SciFact 可用于“引用是否指向相关论文”的自动基础检查；HotpotQA 可进一步验证引用是否指向 supporting facts 所在文章。逐句引用是否被证据支持，仍需要句子级映射或人工标注样本。

## 运行记录

- 2026-07-26：已用隔离的 `SciFact Evaluation` 空间完成 1 个真实问题、10 篇论文的端到端检索冒烟测试。
- 结果：正确论文未进入前 10，`Recall@10 = 0`、`nDCG@10 = 0`。该结果证明评测链路可用，但未达到门槛，且样本量不足，不能作为 Phase 3 出口证据。
- 2026-07-26：固定 200 篇论文（50 题关联的 49 篇正确论文与 151 篇干扰论文）完成 50 题检索基线。`Recall@10 = 0.6133`、`nDCG@10 = 0.4236`；31/50 个问题至少命中一篇正确论文，未达到 `0.85` 与 `0.75` 门槛。SciFact 不含答案引用标注，本次仅运行检索指标，不能替代引用准确率出口检查。

后续实验的编号、数据集说明和结果总览统一维护在 `docs/evaluation/`。
