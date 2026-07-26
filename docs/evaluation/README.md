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

下一步：分析 E001 的 19 道漏检题，创建 E002，只验证一个检索配置改动后复测。
