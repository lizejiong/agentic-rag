# 评测与优化记录

这里集中记录 RAG 的评测数据集、当前分数和每次优化。只保留两个文件：本页看总览，`experiments.md` 按顺序看每次改动。

这种方式保留了社区常见的“固定数据集、独立原始报告、每次实验可复现”原则，但不引入复杂目录。可参考 [Ragas 的实验输出](https://github.com/vibrantlabsai/ragas/blob/master/docs/howtos/applications/evaluate-and-improve-rag.md)、[Promptfoo 的结构化报告](https://www.promptfoo.dev/docs/configuration/outputs/) 和 [lm-evaluation-harness 的可复现配置](https://github.com/EleutherAI/lm-evaluation-harness/blob/main/docs/task_guide.md)。

## 编号规则

- 实验按 `E001`、`E002`、`E003` 顺序递增；编号比日期更重要，方便一眼看出先后。
- 每个实验都写明：对比对象、改了什么、使用的数据、前后分数、结论。
- 原始 JSON/JSONL 报告使用同一个编号，例如 `E002-scifact-50-report.json`，保存在本地 `services/ai/evals/cases/`，不提交 Git。

## 当前评测集

### D001 — BEIR SciFact

- 用途：评估英文科学文本检索质量。
- 固定子集：50 个问题、200 篇论文摘要；其中 49 篇为标注相关论文，151 篇为干扰论文。
- 指标：`Recall@10`、`nDCG@10`；目标分别为 `0.85` 和 `0.75`。
- 来源与许可：[BEIR SciFact 数据集卡](https://huggingface.co/datasets/BeIR/scifact)，CC BY-SA 4.0。
- 局限：不含回答引用标注，不能代替引用准确率测试。

本地数据位置和重新下载方式见 `services/ai/evals/README.md`。

## 当前状态

| 最近实验 | 数据集 | Recall@10 | nDCG@10 | 状态 |
| --- | --- | ---: | ---: | --- |
| [E001](experiments.md#e001--2026-07-26--scifact-初始基线) | D001 SciFact | 0.6133 | 0.4236 | 未达标 |
| [E002](experiments.md#e002--2026-07-26--扩大-rerank-候选数) | D001 SciFact | 0.6133 | 0.4236 | 无变化 |
| [E003](experiments.md#e003--2026-07-26--关闭-mock-reranker) | D001 SciFact | 0.8200 | 0.7597 | 接近达标 |
| [E004](experiments.md#e004--2026-07-26--扩大基础召回候选数) | D001 SciFact | 0.8200 | 0.7597 | 无变化 |
| [E005](experiments.md#e005--2026-07-26--scifact-引用相关性基线) | D001 SciFact | 0.5367 | 0.3981 | 引用链路已验证 |
| [E006](experiments.md#e006--2026-07-27--hotpotqa-文档级证据引用基线) | D002 HotpotQA | 0.6000 | 0.6526 | 文档级引用准确率 0.7833 |

当前最佳检索配置来自 E003：关闭 mock reranker。E006 已使用带 supporting facts 标注的 HotpotQA 验证引用是否指向正确的证据文章；下一步再补充句子级或人工标注，验证回答中的具体表述是否被支持。
