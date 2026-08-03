# 星桥云途中文验收集

这是一套完全虚构的中文互联网公司资料，用于固定验证检索、重排、回答和引用质量。

- 目标知识空间：`星桥云途验收空间`
- 文件：20 个，覆盖 DOCX、PDF、XLSX、PPTX、CSV、TSV
- 题目：25 题，见 `cases.jsonl`
- 每题通过唯一证据短句定位，不依赖每次导入后变化的内部 chunk ID。
- `dataset.json` 是题库清单：定义题库 ID、展示名称、目标知识空间和题目文件。评测中心会自动读取 `services/ai/evals/fixtures/` 下的所有题库目录；新增题库时复制该结构即可，无需改业务代码。

生成资料：

```powershell
uv run --project services/ai python services/ai/scripts/generate_xingqiao_acceptance_files.py --output services/ai/evals/fixtures/xingqiao-acceptance/files
```

将 `files/` 内所有文件上传至唯一的“星桥云途验收空间”，并等待状态全部变为“已完成”后，在管理端的 `/evaluation` 运行 25 题。
