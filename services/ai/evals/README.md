# 社区评测数据集

本项目的 Phase 3 检索基线采用 [BEIR SciFact](https://huggingface.co/datasets/BeIR/scifact)：
它提供 `corpus`、`queries` 和 `qrels`，可直接评估 `Recall@10`、`nDCG@10`。数据集卡标示为
CC BY-SA 4.0；项目发布评测结果或派生数据时应保留署名与相同方式共享要求。

下载的原始语料不提交到 Git：

```powershell
uv run --project services/ai python services/ai/scripts/download_beir_scifact.py --output services/ai/evals/data/beir-scifact
uv run --project services/ai python services/ai/scripts/prepare_scifact_queries.py --dataset-dir services/ai/evals/data/beir-scifact --output services/ai/evals/cases/scifact-50.jsonl --limit 50
```

生成的 `scifact-50.jsonl` 是问题和相关文档 ID 清单，不是最终报告。将 SciFact 语料导入候选环境后，需要记录每个原始文档 ID 对应的内部 `documentId`、从检索接口导出的结果，并转换为 `rag-evaluation.md` 规定的 JSONL 格式，才能运行出口检查。

导入完成后，创建下列文档 ID 映射文件，每行一条：

```json
{"sourceDocumentId":"31715818","documentId":"系统导入后生成的 UUID"}
```

随后可自动运行 50 个问题并计算检索指标：

```powershell
uv run --project services/ai python services/ai/scripts/run_scifact_retrieval.py --cases services/ai/evals/cases/scifact-50.jsonl --document-map services/ai/evals/cases/scifact-document-map.jsonl --output services/ai/evals/cases/scifact-results.jsonl --space-id <评测空间 UUID> --user-id <有查看权限的用户 UUID>
uv run --project services/ai python services/ai/scripts/evaluate_retrieval.py --input services/ai/evals/cases/scifact-results.jsonl --allow-missing-citations
```

SciFact 只覆盖检索质量。回答引用门禁应额外采用带支持事实的
[HotpotQA](https://hotpotqa.github.io/) 开发集，或由项目知识库人工标注的引用样本；HotpotQA 同样采用 CC BY-SA 4.0。
