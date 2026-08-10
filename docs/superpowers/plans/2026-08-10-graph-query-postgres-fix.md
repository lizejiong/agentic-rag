# 图谱查询 PostgreSQL 兼容性修复实施计划

> **给 agentic workers：** 必须使用 `superpowers:executing-plans` 按任务逐项执行本计划。步骤使用 checkbox（`- [ ]`）语法跟踪状态。
**目标：** 修复图谱关系查询中会导致 PostgreSQL 500 的目标表别名作用域错误和可选状态参数类型推断错误。

**架构：** 保持 `GraphRepository` 的公共接口不变。将证据失效判断重写为引用更新目标行的相关 `NOT EXISTS` 子查询，以保留“文档或分块缺失时也须失效”的原有左连接语义；在状态筛选参数上使用显式 `VARCHAR(24)` 转换，确保 `None` 在预编译语句中类型确定。

**技术栈：** Python 3.12、SQLAlchemy 2.x async、PostgreSQL、pytest、pytest-asyncio。

---

### 任务 1：为仓储 SQL 建立回归测试

**文件：**
- 新建：`C:/Users/lzj/Documents/rag/.worktrees/graph-query-sql-fix/services/ai/tests/test_graph_repository.py`
- 修改：`C:/Users/lzj/Documents/rag/.worktrees/graph-query-sql-fix/services/ai/src/rag_ai/graph/repository.py:64-109`（在下一任务）

- [x] **步骤 1：创建测试支架**

```python
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from rag_ai.graph.repository import GraphRepository
from rag_ai.retrieval.models import AclSnapshot


def repository_with_connection(*, connect: bool = False) -> tuple[GraphRepository, AsyncMock]:
    connection = AsyncMock(spec=AsyncConnection)
    context = MagicMock()
    context.__aenter__ = AsyncMock(return_value=connection)
    context.__aexit__ = AsyncMock(return_value=False)
    engine = MagicMock(spec=AsyncEngine)
    if connect:
        engine.connect.return_value = context
    else:
        engine.begin.return_value = context
    return GraphRepository(engine), connection


def returning_ids_result(ids: list[object]) -> MagicMock:
    result = MagicMock()
    result.scalars.return_value = ids
    return result
```

- [x] **步骤 2：编写覆盖 `status=None` 的失败测试**

```python
@pytest.mark.asyncio
async def test_list_relations_types_an_optional_status_parameter() -> None:
    repository, connection = repository_with_connection(connect=True)
    connection.execute.return_value.mappings.return_value.all.return_value = []

    assert await repository.list_relations(uuid4(), AclSnapshot(uuid4(), True), status=None) == []
    statement = connection.execute.await_args.args[0]
    compiled = statement.compile(dialect=postgresql.dialect())
    assert "CAST(%(status)s AS VARCHAR(24)) IS NULL" in str(compiled)
```

- [x] **步骤 3：编写覆盖 `reconcile` 作用域与缺失关联记录语义的失败测试**

```python
@pytest.mark.asyncio
async def test_reconcile_uses_correlated_existence_checks() -> None:
    repository, connection = repository_with_connection()
    connection.execute.side_effect = [MagicMock(), returning_ids_result([])]

    assert await repository.reconcile(uuid4()) == []
    sql = str(connection.execute.await_args_list[0].args[0])
    assert "LEFT JOIN app.documents" not in sql
    assert "NOT EXISTS (SELECT 1 FROM app.documents d" in sql
    assert "NOT EXISTS (SELECT 1 FROM rag.chunks c" in sql
```

- [x] **步骤 4：运行新增测试，确认它们在当前实现上失败**

Run: `uv run --project services/ai pytest services/ai/tests/test_graph_repository.py -q`

Expected: 至少一个断言失败；当前 SQL 包含 `LEFT JOIN app.documents d ON d.id=e.document_id`，且没有显式状态转换。

### 任务 2：修复 PostgreSQL SQL 语义

**文件：**
- 修改：`C:/Users/lzj/Documents/rag/.worktrees/graph-query-sql-fix/services/ai/src/rag_ai/graph/repository.py:75-103`
- 测试：`C:/Users/lzj/Documents/rag/.worktrees/graph-query-sql-fix/services/ai/tests/test_graph_repository.py`

- [x] **步骤 1：为可选状态参数加显式类型**

将筛选条件改为：

```sql
WHERE r.space_id=:space_id
  AND (CAST(:status AS VARCHAR(24)) IS NULL OR r.status=:status)
```

- [x] **步骤 2：把证据失效更新改为相关子查询**

用以下语句替换首个 `UPDATE` 的内容：

```sql
UPDATE rag.graph_evidence e SET active=FALSE
FROM rag.graph_relations r
WHERE e.relation_id=r.id AND r.space_id=:space_id
  AND (
    NOT EXISTS (
      SELECT 1 FROM app.documents d
      WHERE d.id=e.document_id
        AND d.active_version_id=e.version_id
        AND d.availability='ACTIVE'
    )
    OR NOT EXISTS (
      SELECT 1 FROM rag.chunks c
      WHERE c.id=e.chunk_id AND c.is_searchable=TRUE
    )
  )
```

该写法不在 `FROM` 的 join 条件中引用 `e`，同时会将不存在、非活动版本、不可用文档及不可搜索分块的证据统一标记为失效。

- [x] **步骤 3：运行仓储回归测试，确认通过**

Run: `uv run --project services/ai pytest services/ai/tests/test_graph_repository.py -q`

Expected: 所有新增测试通过。

### 任务 3：执行项目级质量检查并提交

**文件：**
- 修改：`C:/Users/lzj/Documents/rag/.worktrees/graph-query-sql-fix/services/ai/src/rag_ai/graph/repository.py`
- 新建：`C:/Users/lzj/Documents/rag/.worktrees/graph-query-sql-fix/services/ai/tests/test_graph_repository.py`

- [x] **步骤 1：运行图谱相关测试**

Run: `uv run --project services/ai pytest services/ai/tests/test_graph_repository.py services/ai/tests/test_graph_paths.py services/ai/tests/test_graph_query_tool.py -q`

Expected: 全部通过。

- [x] **步骤 2：运行静态检查**

Run: `uv run --project services/ai ruff check src/rag_ai/graph/repository.py tests/test_graph_repository.py`

Expected: `All checks passed!`

- [x] **步骤 3：检查变更范围**

Run: `git diff --check && git status --short`

Expected: 没有空白错误，且仅包含仓储实现、其测试及本实施计划。

- [x] **步骤 4：创建提交**

```bash
git add services/ai/src/rag_ai/graph/repository.py services/ai/tests/test_graph_repository.py docs/superpowers/plans/2026-08-10-graph-query-postgres-fix.md
git commit -m "fix: restore PostgreSQL graph relation queries"
```
