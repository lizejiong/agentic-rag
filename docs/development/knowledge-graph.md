# 知识图谱治理

空间管理员在空间概览中启用“图谱候选抽取”后，新完成索引的文档版本会按 Chunk 提取候选实体和关系。候选只有在引用片段是该 Chunk 的连续原文时才会保存；抽取失败不会阻塞文档检索。

在“知识图谱”页面中，所有有 `VIEW` 权限的成员只能浏览已发布关系；每条关系都显示可打开的来源文档。拥有空间 `MANAGE` 权限的成员可以审核发布或驳回候选。发布前会再次确认至少一条来源 Chunk 属于当前活动版本、仍可检索且可访问。

关系纠错、回滚、实体合并与拆分通过 `/spaces/:spaceId/graph` 下的管理接口执行。人工改动会写入审计日志和图谱修订记录，并把受影响关系置为待审核；只有再次发布的关系才会投影到 Neo4j。

路径查询最多三跳，只返回已发布、仍由当前活动文档证据支持、且调用者可读取证据的关系。聊天的图谱补充同样只使用这些关系，并始终引用原始 Chunk，不会生成没有文件来源的图谱引用。

部署前执行：

```powershell
uv run --project services/ai alembic -c services/ai/alembic.ini upgrade head
```

配置项：

```dotenv
NEO4J_URI=bolt://127.0.0.1:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=<local-development-password>
```
