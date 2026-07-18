# 仓库骨架与流协议实施计划

> **执行要求：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务执行。使用 checkbox（`- [ ]`）跟踪状态；每个任务完成后立即运行对应验证并提交。

**目标：** 在空仓库中建立 React、NestJS、Python 三层骨架，完成可取消的 Python NDJSON → NestJS AI SDK UI Message Stream → React `useChat` 假问答闭环。

**架构：** React 只连接 NestJS；NestJS 将浏览器请求转换为 Python 内部运行请求，逐条消费 NDJSON `AgentEvent`，再通过 `createUIMessageStream` 和 `pipeUIMessageStreamToResponse` 输出。浏览器断开或点击停止时，AbortSignal 必须向 Python 传播；本计划不接数据库、真实模型或身份系统。

**技术栈：** pnpm workspace、TypeScript、React、Vite、Vercel AI SDK UI、NestJS、Vitest、Jest、Python 3.12、uv、FastAPI、Pydantic、pytest、Ruff、mypy。

**锁定工具链：** Node.js 22 或 24、pnpm 11.14.0、uv 0.11.29、AI SDK 7.0.31、`@ai-sdk/react` 4.0.34、NestJS 11。

执行前验证：

```bash
node --version
corepack prepare pnpm@11.14.0 --activate
pnpm --version
uv --version
uv python install 3.12
```

若 `uv` 尚未安装，使用 [Astral 官方安装方式](https://docs.astral.sh/uv/getting-started/installation/) 安装固定版本 0.11.29，然后重新执行上述验证。AI SDK 的 NestJS 流桥接以 [官方 NestJS 示例](https://ai-sdk.dev/cookbook/api-servers/nest) 和 [UI Message Stream 协议](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol) 为实现依据。

---

## 范围边界

本计划交付：

- 根 workspace 和统一命令。
- `apps/web`、`apps/api`、`services/ai`、`packages/contracts`。
- TypeScript/Python 共用 JSONL fixture。
- Python 假 Agent NDJSON 流。
- NestJS AI SDK UI Message Stream 适配。
- React 文本、状态、引用和停止按钮。
- 取消、序号、缓冲上限、协议版本和错误测试。
- CI 与开发文档。

本计划不交付：

- PostgreSQL、Redis、Elasticsearch、Neo4j、MinIO 或 Docker Compose。
- 登录、ACL、文档上传、真实检索、真实模型、图谱、记忆和语音。
- Deep Agents。

## 文件结构

```text
.
├─ apps/
│  ├─ api/
│  │  ├─ src/
│  │  │  ├─ ai/
│  │  │  │  ├─ ai-event-source.ts
│  │  │  │  ├─ ai-stream.mapper.ts
│  │  │  │  ├─ ndjson.ts
│  │  │  │  └─ python-ai.client.ts
│  │  │  ├─ chat/
│  │  │  │  ├─ active-run.registry.ts
│  │  │  │  ├─ chat.controller.ts
│  │  │  │  ├─ chat.module.ts
│  │  │  │  ├─ chat-protocol.guard.ts
│  │  │  │  └─ chat.request.ts
│  │  │  ├─ health/
│  │  │  └─ main.ts
│  │  └─ test/
│  └─ web/
│     └─ src/
│        ├─ features/chat/
│        └─ test/setup.ts
├─ packages/
│  └─ contracts/
│     ├─ fixtures/agent-events.jsonl
│     ├─ src/agent-events.ts
│     ├─ src/ui-message.ts
│     └─ test/agent-events.spec.ts
├─ services/
│  └─ ai/
│     ├─ src/rag_ai/
│     │  ├─ __init__.py
│     │  ├─ contracts/
│     │  ├─ routes/
│     │  ├─ runtime/
│     │  └─ streaming/
│     └─ tests/
├─ scripts/
│  ├─ check-workspace.mjs
│  └─ smoke-chat.mjs
├─ .github/workflows/ci.yml
├─ package.json
├─ pnpm-workspace.yaml
└─ tsconfig.base.json
```

### 任务 1：建立根 workspace

**文件：**

- 新建：`package.json`
- 新建：`pnpm-workspace.yaml`
- 新建：`tsconfig.base.json`
- 新建：`.editorconfig`
- 新建：`.prettierrc.json`
- 修改：`.gitignore`
- 新建：`scripts/check-workspace.mjs`

- [ ] **步骤 1：先写 workspace 结构检查脚本**

```js
// scripts/check-workspace.mjs
import { existsSync } from 'node:fs';

const required = [
  'package.json',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'apps/web/package.json',
  'apps/api/package.json',
  'packages/contracts/package.json',
  'services/ai/pyproject.toml',
];

const missing = required.filter(path => !existsSync(path));

if (missing.length > 0) {
  console.error(`Missing workspace files:\n${missing.join('\n')}`);
  process.exit(1);
}

console.log('Workspace structure is complete.');
```

- [ ] **步骤 2：运行检查并确认它因根配置和应用尚不存在而失败**

运行：`node scripts/check-workspace.mjs`

预期：退出码为 1，并列出 `package.json`、`apps/web/package.json` 等缺失文件。

- [ ] **步骤 3：写入根 workspace 配置**

```json
// package.json
{
  "name": "enterprise-rag",
  "private": true,
  "packageManager": "pnpm@11.14.0",
  "engines": {
    "node": ">=22.0.0"
  },
  "scripts": {
    "check:workspace": "node scripts/check-workspace.mjs",
    "dev:web": "pnpm --filter @rag/web dev",
    "dev:api": "pnpm --filter @rag/api start:dev",
    "dev:ai": "uv run --project services/ai uvicorn rag_ai.main:app --reload --port 8001",
    "prepare:contracts": "pnpm --filter @rag/contracts build",
    "lint": "pnpm prepare:contracts && pnpm -r --if-present lint && uv run --project services/ai ruff check services/ai",
    "typecheck": "pnpm prepare:contracts && pnpm -r --if-present typecheck && uv run --project services/ai mypy services/ai/src",
    "test": "pnpm prepare:contracts && pnpm -r --if-present test && uv run --project services/ai pytest services/ai/tests",
    "build": "pnpm -r --if-present build && uv build --project services/ai",
    "smoke:chat": "node scripts/smoke-chat.mjs"
  }
}
```

```yaml
# pnpm-workspace.yaml
packages:
  - apps/*
  - packages/*
```

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

```ini
# .editorconfig
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2

[*.py]
indent_size = 4
```

```json
// .prettierrc.json
{
  "singleQuote": true,
  "semi": true,
  "trailingComma": "all",
  "printWidth": 100
}
```

在现有 `.gitignore` 保留 `.worktrees/`，并追加：

```gitignore
node_modules/
**/node_modules/
**/dist/
**/.venv/
**/.pytest_cache/
**/.mypy_cache/
**/.ruff_cache/
coverage/
```

- [ ] **步骤 4：启用 pnpm 并生成初始 lockfile**

运行：

```bash
corepack enable
corepack prepare pnpm@11.14.0 --activate
pnpm install
```

预期：生成 `pnpm-lock.yaml`；`pnpm --version` 输出 `11.14.0`。

- [ ] **步骤 5：提交根配置**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json .editorconfig .prettierrc.json .gitignore scripts/check-workspace.mjs
git commit -m "chore: initialize monorepo workspace"
```

### 任务 2：建立跨语言 AgentEvent 契约

**文件：**

- 新建：`packages/contracts/package.json`
- 新建：`packages/contracts/tsconfig.json`
- 新建：`packages/contracts/src/agent-events.ts`
- 新建：`packages/contracts/src/ui-message.ts`
- 新建：`packages/contracts/src/index.ts`
- 新建：`packages/contracts/fixtures/agent-events.jsonl`
- 新建：`packages/contracts/test/agent-events.spec.ts`

- [ ] **步骤 1：创建 contracts package 和失败测试**

```json
// packages/contracts/package.json
{
  "name": "@rag/contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "lint": "tsc --noEmit",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "build": "tsup src/index.ts --format esm --dts --clean"
  }
}
```

```json
// packages/contracts/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["vitest/globals"]
  },
  "include": ["src", "test"]
}
```

```ts
// packages/contracts/test/agent-events.spec.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { agentEventSchema } from '../src/agent-events';

describe('AgentEvent fixture', () => {
  it('parses every JSONL event and preserves monotonic sequence numbers', () => {
    const events = readFileSync(
      new URL('../fixtures/agent-events.jsonl', import.meta.url),
      'utf8',
    )
      .trim()
      .split('\n')
      .map(line => agentEventSchema.parse(JSON.parse(line)));

    expect(events.map(event => event.seq)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(events.at(-1)?.type).toBe('run.completed');
  });
});
```

- [ ] **步骤 2：安装依赖并运行测试，确认缺少契约实现**

运行：

```bash
pnpm --filter @rag/contracts add ai@7.0.31 zod
pnpm --filter @rag/contracts add -D typescript tsup vitest @types/node
pnpm --filter @rag/contracts test
```

预期：失败，错误包含 `Cannot find module '../src/agent-events'`。

- [ ] **步骤 3：实现 AgentEvent Zod schema**

```ts
// packages/contracts/src/agent-events.ts
import { z } from 'zod';

const eventBase = {
  requestId: z.string().uuid(),
  traceId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  occurredAt: z.string().datetime(),
};

const citationLocationSchema = z.object({
  page: z.number().int().positive().optional(),
  slide: z.number().int().positive().optional(),
  sheet: z.string().min(1).optional(),
  cellRange: z.string().min(1).optional(),
});

export const agentEventSchema = z.discriminatedUnion('type', [
  z.object({ ...eventBase, type: z.literal('run.started') }),
  z.object({
    ...eventBase,
    type: z.literal('run.status'),
    status: z.enum(['understanding', 'retrieving', 'ranking', 'answering']),
  }),
  z.object({
    ...eventBase,
    type: z.literal('text.delta'),
    text: z.string().min(1),
  }),
  z.object({
    ...eventBase,
    type: z.literal('citation'),
    citationId: z.string().uuid(),
    title: z.string().min(1),
    snippet: z.string(),
    location: citationLocationSchema,
  }),
  z.object({
    ...eventBase,
    type: z.literal('run.completed'),
    finishReason: z.enum(['stop', 'cancelled']),
  }),
  z.object({
    ...eventBase,
    type: z.literal('run.failed'),
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
  }),
]);

export type AgentEvent = z.infer<typeof agentEventSchema>;

export const runRequestSchema = z.object({
  requestId: z.string().uuid(),
  traceId: z.string().min(1),
  actorId: z.string().min(1),
  question: z.string().trim().min(1).max(8_000),
  selectedSpaceIds: z.array(z.string().uuid()).max(20),
});

export type RunRequest = z.infer<typeof runRequestSchema>;
```

```ts
// packages/contracts/src/ui-message.ts
import type { UIMessage } from 'ai';

export type RagUIDataParts = {
  'agent-status': {
    status: 'understanding' | 'retrieving' | 'ranking' | 'answering' | 'cancelled';
    seq: number;
  };
  citation: {
    citationId: string;
    title: string;
    snippet: string;
    location: {
      page?: number;
      slide?: number;
      sheet?: string;
      cellRange?: string;
    };
  };
};

export type RagUIMessage = UIMessage<never, RagUIDataParts>;
```

```ts
// packages/contracts/src/index.ts
export * from './agent-events';
export * from './ui-message';
```

- [ ] **步骤 4：添加固定 JSONL fixture**

```jsonl
{"requestId":"00000000-0000-4000-8000-000000000001","traceId":"trace-fixture","seq":0,"occurredAt":"2026-07-18T00:00:00.000Z","type":"run.started"}
{"requestId":"00000000-0000-4000-8000-000000000001","traceId":"trace-fixture","seq":1,"occurredAt":"2026-07-18T00:00:00.001Z","type":"run.status","status":"retrieving"}
{"requestId":"00000000-0000-4000-8000-000000000001","traceId":"trace-fixture","seq":2,"occurredAt":"2026-07-18T00:00:00.002Z","type":"text.delta","text":"答案"}
{"requestId":"00000000-0000-4000-8000-000000000001","traceId":"trace-fixture","seq":3,"occurredAt":"2026-07-18T00:00:00.003Z","type":"citation","citationId":"00000000-0000-4000-8000-000000000002","title":"示例文档","snippet":"示例证据","location":{"page":1}}
{"requestId":"00000000-0000-4000-8000-000000000001","traceId":"trace-fixture","seq":4,"occurredAt":"2026-07-18T00:00:00.004Z","type":"text.delta","text":"完成"}
{"requestId":"00000000-0000-4000-8000-000000000001","traceId":"trace-fixture","seq":5,"occurredAt":"2026-07-18T00:00:00.005Z","type":"run.completed","finishReason":"stop"}
```

- [ ] **步骤 5：运行并通过契约测试与构建**

运行：

```bash
pnpm --filter @rag/contracts test
pnpm --filter @rag/contracts typecheck
pnpm --filter @rag/contracts build
```

预期：1 个测试通过，生成 `packages/contracts/dist/index.js` 和 `index.d.ts`。

- [ ] **步骤 6：提交契约**

```bash
git add packages/contracts pnpm-lock.yaml
git commit -m "feat: define cross-service agent event contract"
```

### 任务 3：建立 FastAPI AI 服务和可取消 NDJSON 假流

**文件：**

- 新建：`services/ai/pyproject.toml`
- 新建：`services/ai/src/rag_ai/__init__.py`
- 新建：`services/ai/src/rag_ai/contracts/__init__.py`
- 新建：`services/ai/src/rag_ai/routes/__init__.py`
- 新建：`services/ai/src/rag_ai/runtime/__init__.py`
- 新建：`services/ai/src/rag_ai/streaming/__init__.py`
- 新建：`services/ai/src/rag_ai/main.py`
- 新建：`services/ai/src/rag_ai/contracts/agent_events.py`
- 新建：`services/ai/src/rag_ai/runtime/fake_agent.py`
- 新建：`services/ai/src/rag_ai/runtime/registry.py`
- 新建：`services/ai/src/rag_ai/streaming/ndjson.py`
- 新建：`services/ai/src/rag_ai/routes/health.py`
- 新建：`services/ai/src/rag_ai/routes/runs.py`
- 新建：`services/ai/tests/test_contract_fixture.py`
- 新建：`services/ai/tests/test_health.py`
- 新建：`services/ai/tests/test_runs.py`
- 新建：`services/ai/tests/test_streaming_ndjson.py`

- [ ] **步骤 1：写 Python 项目配置和失败测试**

```toml
# services/ai/pyproject.toml
[project]
name = "rag-ai"
version = "0.0.0"
requires-python = ">=3.12,<3.14"
dependencies = [
  "fastapi>=0.116,<1",
  "pydantic>=2.11,<3",
  "uvicorn>=0.35,<1",
]

[dependency-groups]
dev = [
  "httpx>=0.28,<1",
  "mypy>=1.17,<2",
  "pytest>=8.4,<9",
  "pytest-asyncio>=1.1,<2",
  "ruff>=0.12,<1",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/rag_ai"]

[tool.pytest.ini_options]
pythonpath = ["src"]
asyncio_mode = "auto"

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.mypy]
python_version = "3.12"
strict = true
packages = ["rag_ai"]
```

```py
# services/ai/tests/test_health.py
from fastapi.testclient import TestClient

from rag_ai.main import app


def test_health_endpoints() -> None:
    client = TestClient(app)
    assert client.get("/health/live").json() == {"status": "live"}
    assert client.get("/health/ready").json() == {"status": "ready"}
```

- [ ] **步骤 2：安装 Python 依赖并确认测试因应用缺失而失败**

运行：

```bash
uv sync --project services/ai
uv run --project services/ai pytest services/ai/tests/test_health.py -q
```

预期：失败，错误包含 `No module named 'rag_ai.main'`。

- [ ] **步骤 3：实现健康端点**

先创建文件清单中的 5 个空 `__init__.py`，确保本地运行、mypy 和 wheel 构建使用同一包边界。

```py
# services/ai/src/rag_ai/routes/health.py
from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health/live")
async def live() -> dict[str, str]:
    return {"status": "live"}


@router.get("/health/ready")
async def ready() -> dict[str, str]:
    return {"status": "ready"}
```

```py
# services/ai/src/rag_ai/main.py
from fastapi import FastAPI

from rag_ai.routes.health import router as health_router

app = FastAPI(title="RAG AI Service", version="0.0.0")
app.include_router(health_router)
```

- [ ] **步骤 4：运行健康测试并确认通过**

运行：`uv run --project services/ai pytest services/ai/tests/test_health.py -q`

预期：1 个测试通过。

- [ ] **步骤 5：写契约 fixture 和流式运行失败测试**

```py
# services/ai/tests/test_contract_fixture.py
import json
from pathlib import Path

from pydantic import TypeAdapter

from rag_ai.contracts.agent_events import AgentEvent

agent_event_adapter = TypeAdapter(AgentEvent)


def test_typescript_fixture_parses_in_python() -> None:
    fixture = (
        Path(__file__).parents[2]
        / "packages"
        / "contracts"
        / "fixtures"
        / "agent-events.jsonl"
    )
    events = [
        agent_event_adapter.validate_python(json.loads(line))
        for line in fixture.read_text(encoding="utf-8").splitlines()
    ]
    assert [event.seq for event in events] == list(range(6))
```

```py
# services/ai/tests/test_runs.py
import json

from fastapi.testclient import TestClient

from rag_ai.main import app


def test_run_stream_is_monotonic_ndjson() -> None:
    client = TestClient(app)
    payload = {
        "requestId": "00000000-0000-4000-8000-000000000010",
        "traceId": "trace-test",
        "actorId": "actor-test",
        "question": "什么是混合检索？",
        "selectedSpaceIds": [],
    }
    with client.stream("POST", "/v1/agent/runs", json=payload) as response:
        events = [json.loads(line) for line in response.iter_lines() if line]

    assert response.headers["content-type"].startswith("application/x-ndjson")
    assert [event["seq"] for event in events] == list(range(len(events)))
    assert events[0]["type"] == "run.started"
    assert events[-1]["type"] == "run.completed"
    assert any(event["type"] == "citation" for event in events)


def test_cancel_is_idempotent() -> None:
    client = TestClient(app)
    request_id = "00000000-0000-4000-8000-000000000011"
    first = client.post(f"/v1/agent/runs/{request_id}/cancel")
    second = client.post(f"/v1/agent/runs/{request_id}/cancel")
    assert first.status_code == 202
    assert second.status_code == 202
```

- [ ] **步骤 6：运行新测试并确认失败**

运行：`uv run --project services/ai pytest services/ai/tests/test_contract_fixture.py services/ai/tests/test_runs.py -q`

预期：失败，缺少 `rag_ai.contracts.agent_events` 和 `/v1/agent/runs`。

- [ ] **步骤 7：实现 Pydantic 契约和运行注册表**

```py
# services/ai/src/rag_ai/contracts/agent_events.py
from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, Field


class EventBase(BaseModel):
    requestId: UUID
    traceId: str
    seq: int = Field(ge=0)
    occurredAt: datetime


class RunStarted(EventBase):
    type: Literal["run.started"]


class RunStatus(EventBase):
    type: Literal["run.status"]
    status: Literal["understanding", "retrieving", "ranking", "answering"]


class TextDelta(EventBase):
    type: Literal["text.delta"]
    text: str


class CitationLocation(BaseModel):
    page: int | None = Field(default=None, ge=1)
    slide: int | None = Field(default=None, ge=1)
    sheet: str | None = None
    cellRange: str | None = None


class Citation(EventBase):
    type: Literal["citation"]
    citationId: UUID
    title: str
    snippet: str
    location: CitationLocation


class RunCompleted(EventBase):
    type: Literal["run.completed"]
    finishReason: Literal["stop", "cancelled"]


class RunFailed(EventBase):
    type: Literal["run.failed"]
    code: str
    message: str
    retryable: bool


AgentEvent = Annotated[
    RunStarted | RunStatus | TextDelta | Citation | RunCompleted | RunFailed,
    Field(discriminator="type"),
]


class RunRequest(BaseModel):
    requestId: UUID
    traceId: str
    actorId: str
    question: str = Field(min_length=1, max_length=8_000)
    selectedSpaceIds: list[UUID] = Field(max_length=20)
```

```py
# services/ai/src/rag_ai/streaming/ndjson.py
from rag_ai.contracts.agent_events import AgentEvent


def encode_ndjson(event: AgentEvent, max_record_bytes: int = 64 * 1024) -> str:
    line = event.model_dump_json(by_alias=True) + "\n"
    if len(line.encode("utf-8")) > max_record_bytes:
        raise ValueError("NDJSON record exceeded 64 KiB")
    return line
```

```py
# services/ai/tests/test_streaming_ndjson.py
from datetime import UTC, datetime
from uuid import UUID

import pytest

from rag_ai.contracts.agent_events import TextDelta
from rag_ai.streaming.ndjson import encode_ndjson


def test_encode_ndjson_rejects_oversized_record() -> None:
    event = TextDelta(
        requestId=UUID("00000000-0000-4000-8000-000000000001"),
        traceId="trace",
        seq=0,
        occurredAt=datetime.now(UTC),
        type="text.delta",
        text="x" * (64 * 1024),
    )
    with pytest.raises(ValueError, match="64 KiB"):
        encode_ndjson(event)
```

```py
# services/ai/src/rag_ai/runtime/registry.py
import asyncio
from uuid import UUID


class RunRegistry:
    def __init__(self) -> None:
        self._cancel_events: dict[UUID, asyncio.Event] = {}

    def event_for(self, request_id: UUID) -> asyncio.Event:
        return self._cancel_events.setdefault(request_id, asyncio.Event())

    def cancel(self, request_id: UUID) -> None:
        event = self._cancel_events.get(request_id)
        if event is not None:
            event.set()

    def release(self, request_id: UUID) -> None:
        self._cancel_events.pop(request_id, None)


registry = RunRegistry()
```

- [ ] **步骤 8：实现假 Agent 和 NDJSON 路由**

```py
# services/ai/src/rag_ai/runtime/fake_agent.py
import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import TypedDict
from uuid import UUID

from rag_ai.contracts.agent_events import (
    AgentEvent,
    Citation,
    CitationLocation,
    RunCompleted,
    RunRequest,
    RunStarted,
    RunStatus,
    TextDelta,
)

class EventFields(TypedDict):
    requestId: UUID
    traceId: str
    seq: int
    occurredAt: datetime


async def fake_agent_events(
    request: RunRequest,
    cancelled: asyncio.Event,
) -> AsyncIterator[AgentEvent]:
    seq = 0

    def base() -> EventFields:
        nonlocal seq
        value = {
            "requestId": request.requestId,
            "traceId": request.traceId,
            "seq": seq,
            "occurredAt": datetime.now(UTC),
        }
        seq += 1
        return value

    yield RunStarted(type="run.started", **base())
    yield RunStatus(type="run.status", status="retrieving", **base())

    for token in ("这是", "一个", "可取消", "的假答案"):
        if cancelled.is_set():
            yield RunCompleted(type="run.completed", finishReason="cancelled", **base())
            return
        await asyncio.sleep(0.01)
        yield TextDelta(type="text.delta", text=token, **base())

    yield Citation(
        type="citation",
        citationId=UUID("00000000-0000-4000-8000-000000000002"),
        title="协议示例文档",
        snippet="仅用于验证流式引用。",
        location=CitationLocation(page=1),
        **base(),
    )
    yield RunCompleted(type="run.completed", finishReason="stop", **base())
```

```py
# services/ai/src/rag_ai/routes/runs.py
from collections.abc import AsyncIterator
from uuid import UUID

from fastapi import APIRouter, status
from fastapi.responses import StreamingResponse

from rag_ai.contracts.agent_events import RunRequest
from rag_ai.runtime.fake_agent import fake_agent_events
from rag_ai.runtime.registry import registry
from rag_ai.streaming.ndjson import encode_ndjson

router = APIRouter(prefix="/v1/agent/runs", tags=["runs"])


@router.post("")
async def run(request: RunRequest) -> StreamingResponse:
    cancelled = registry.event_for(request.requestId)

    async def stream() -> AsyncIterator[str]:
        try:
            async for event in fake_agent_events(request, cancelled):
                yield encode_ndjson(event)
        finally:
            registry.release(request.requestId)

    return StreamingResponse(stream(), media_type="application/x-ndjson")


@router.post("/{request_id}/cancel", status_code=status.HTTP_202_ACCEPTED)
async def cancel(request_id: UUID) -> dict[str, str]:
    registry.cancel(request_id)
    return {"status": "cancelling"}
```

在 `services/ai/src/rag_ai/main.py` 加入：

```py
from rag_ai.routes.runs import router as runs_router

app.include_router(runs_router)
```

- [ ] **步骤 9：运行 Python 全部质量检查**

运行：

```bash
uv run --project services/ai ruff check services/ai
uv run --project services/ai mypy services/ai/src
uv run --project services/ai pytest services/ai/tests -q
```

预期：Ruff 和 mypy 无错误，5 个测试通过。

- [ ] **步骤 10：提交 AI 服务**

```bash
git add services/ai
git commit -m "feat: add cancellable fake ai event stream"
```

### 任务 4：建立 NestJS API、健康检查和 NDJSON 客户端

**文件：**

- 新建：`apps/api/*`（Nest CLI）
- 新建：`apps/api/src/health/health.controller.ts`
- 新建：`apps/api/src/health/health.controller.spec.ts`
- 新建：`apps/api/src/ai/ndjson.ts`
- 新建：`apps/api/src/ai/ndjson.spec.ts`
- 新建：`apps/api/src/ai/ai-event-source.ts`
- 新建：`apps/api/src/ai/python-ai.client.ts`
- 修改：`apps/api/src/app.module.ts`

- [ ] **步骤 1：使用 Nest CLI 建立严格模式应用**

运行：

```bash
pnpm dlx @nestjs/cli@11.0.24 new apps/api --package-manager pnpm --skip-git --strict
```

然后将 `apps/api/package.json` 的 `name` 改为 `@rag/api`，加入：

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **步骤 2：先写健康检查失败测试**

```ts
// apps/api/src/health/health.controller.spec.ts
import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports live and ready', async () => {
    const module = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    const controller = module.get(HealthController);
    expect(controller.live()).toEqual({ status: 'live' });
    expect(controller.ready()).toEqual({ status: 'ready' });
  });
});
```

- [ ] **步骤 3：运行测试并确认缺少 controller**

运行：`pnpm --filter @rag/api test -- health.controller.spec.ts`

预期：失败，无法找到 `./health.controller`。

- [ ] **步骤 4：实现健康 controller**

```ts
// apps/api/src/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get('live')
  live() {
    return { status: 'live' } as const;
  }

  @Get('ready')
  ready() {
    return { status: 'ready' } as const;
  }
}
```

在 `app.module.ts` 注册 `HealthController`。

- [ ] **步骤 5：先写有缓冲上限的 NDJSON 解析测试**

```ts
// apps/api/src/ai/ndjson.spec.ts
import { collectNdjson } from './ndjson';

describe('collectNdjson', () => {
  it('parses records split across chunks', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"seq":0}\n{"se'));
        controller.enqueue(new TextEncoder().encode('q":1}\n'));
        controller.close();
      },
    });
    await expect(collectNdjson(stream, 64 * 1024)).resolves.toEqual([
      { seq: 0 },
      { seq: 1 },
    ]);
  });

  it('rejects an unterminated record larger than the cap', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(32)));
        controller.close();
      },
    });
    await expect(collectNdjson(stream, 16)).rejects.toThrow('NDJSON buffer exceeded');
  });

  it('accepts a large chunk made of individually small records', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            Array.from({ length: 100 }, (_, seq) => JSON.stringify({ seq })).join('\n') +
              '\n',
          ),
        );
        controller.close();
      },
    });
    await expect(collectNdjson(stream, 32)).resolves.toHaveLength(100);
  });
});
```

- [ ] **步骤 6：实现逐条 NDJSON 解析器**

```ts
// apps/api/src/ai/ndjson.ts
export async function* parseNdjson(
  stream: ReadableStream<Uint8Array>,
  maxBufferBytes = 64 * 1024,
): AsyncGenerator<unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += value ? decoder.decode(value, { stream: !done }) : decoder.decode();

      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (Buffer.byteLength(line, 'utf8') > maxBufferBytes) {
          throw new Error('NDJSON buffer exceeded');
        }
        if (line) {
          yield JSON.parse(line);
        }
        newline = buffer.indexOf('\n');
      }

      if (Buffer.byteLength(buffer, 'utf8') > maxBufferBytes) {
        throw new Error('NDJSON buffer exceeded');
      }
      if (done) break;
    }

    if (buffer.trim()) yield JSON.parse(buffer);
  } finally {
    reader.releaseLock();
  }
}

export async function collectNdjson(
  stream: ReadableStream<Uint8Array>,
  maxBufferBytes: number,
): Promise<unknown[]> {
  const records: unknown[] = [];
  for await (const record of parseNdjson(stream, maxBufferBytes)) records.push(record);
  return records;
}
```

- [ ] **步骤 7：定义 Python AI 客户端接口与实现**

```ts
// apps/api/src/ai/ai-event-source.ts
import type { AgentEvent, RunRequest } from '@rag/contracts';

export interface AiEventSource {
  run(request: RunRequest, signal: AbortSignal): AsyncIterable<AgentEvent>;
  cancel(requestId: string): Promise<void>;
}

export const AI_EVENT_SOURCE = Symbol('AI_EVENT_SOURCE');
```

```ts
// apps/api/src/ai/python-ai.client.ts
import { Injectable } from '@nestjs/common';
import { agentEventSchema, type AgentEvent, type RunRequest } from '@rag/contracts';
import { parseNdjson } from './ndjson';
import type { AiEventSource } from './ai-event-source';

@Injectable()
export class PythonAiClient implements AiEventSource {
  private readonly baseUrl = process.env.AI_SERVICE_URL ?? 'http://127.0.0.1:8001';

  async *run(request: RunRequest, signal: AbortSignal): AsyncIterable<AgentEvent> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/agent/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`AI service failed with ${response.status}`);
      }

      let expectedSeq = 0;
      for await (const value of parseNdjson(response.body)) {
        const event = agentEventSchema.parse(value);
        if (event.seq !== expectedSeq) throw new Error('Non-monotonic AI event sequence');
        expectedSeq += 1;
        yield event;
      }
    } finally {
      if (signal.aborted) {
        await this.cancel(request.requestId).catch(() => undefined);
      }
    }
  }

  async cancel(requestId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/v1/agent/runs/${requestId}/cancel`, {
      method: 'POST',
    });
    if (!response.ok) throw new Error(`AI cancellation failed with ${response.status}`);
  }
}
```

安装依赖：

```bash
pnpm --filter @rag/api add @rag/contracts@workspace:* zod
```

- [ ] **步骤 8：运行 API 单元测试和类型检查**

运行：

```bash
pnpm --filter @rag/contracts build
pnpm --filter @rag/api test
pnpm --filter @rag/api typecheck
```

预期：健康和 NDJSON 测试通过，TypeScript 无错误。

- [ ] **步骤 9：提交 API 基础**

```bash
git add apps/api package.json pnpm-lock.yaml
git commit -m "feat: add api health and python event client"
```

### 任务 5：将 AgentEvent 映射为 AI SDK UI Message Stream

**文件：**

- 新建：`apps/api/src/chat/chat.request.ts`
- 新建：`apps/api/src/ai/ai-stream.mapper.ts`
- 新建：`apps/api/src/ai/ai-stream.mapper.spec.ts`
- 新建：`apps/api/src/chat/active-run.registry.ts`
- 新建：`apps/api/src/chat/active-run.registry.spec.ts`
- 新建：`apps/api/src/chat/chat.controller.ts`
- 新建：`apps/api/src/chat/chat.controller.spec.ts`
- 新建：`apps/api/src/chat/chat.module.ts`
- 修改：`apps/api/src/app.module.ts`

- [ ] **步骤 1：安装 AI SDK 并写 mapper 失败测试**

运行：`pnpm --filter @rag/api add ai@7.0.31`

```ts
// apps/api/src/ai/ai-stream.mapper.spec.ts
import type { RagUIMessage } from '@rag/contracts';
import type { UIMessageStreamWriter } from 'ai';
import { AiStreamMapper } from './ai-stream.mapper';

describe('AiStreamMapper', () => {
  it('maps citation without exposing ACL data', () => {
    const chunks: Parameters<UIMessageStreamWriter<RagUIMessage>['write']>[0][] = [];
    const mapper = new AiStreamMapper(chunk => chunks.push(chunk));
    mapper.write({
      type: 'citation',
      requestId: '00000000-0000-4000-8000-000000000001',
      traceId: 'trace',
      seq: 0,
      occurredAt: '2026-07-18T00:00:00.000Z',
      citationId: '00000000-0000-4000-8000-000000000002',
      title: '文档',
      snippet: '证据',
      location: { page: 1 },
    });
    expect(chunks).toContainEqual({
      type: 'data-citation',
      id: '00000000-0000-4000-8000-000000000002',
      data: {
        citationId: '00000000-0000-4000-8000-000000000002',
        title: '文档',
        snippet: '证据',
        location: { page: 1 },
      },
    });
    expect(JSON.stringify(chunks)).not.toContain('acl');
  });
});
```

- [ ] **步骤 2：运行测试并确认 mapper 尚不存在**

运行：`pnpm --filter @rag/api test -- ai-stream.mapper.spec.ts`

预期：失败，找不到 `./ai-stream.mapper`。

- [ ] **步骤 3：实现 mapper**

```ts
// apps/api/src/ai/ai-stream.mapper.ts
import type { AgentEvent, RagUIMessage } from '@rag/contracts';
import type { UIMessageStreamWriter } from 'ai';

type WriteChunk = UIMessageStreamWriter<RagUIMessage>['write'];

export class AiStreamMapper {
  private textStarted = false;

  constructor(private readonly writeChunk: WriteChunk) {}

  write(event: AgentEvent): void {
    switch (event.type) {
      case 'run.started':
        this.writeChunk({ type: 'start' });
        return;
      case 'run.status':
        this.writeChunk({
          type: 'data-agent-status',
          id: `status-${event.requestId}`,
          data: { status: event.status, seq: event.seq },
          transient: true,
        });
        return;
      case 'text.delta':
        if (!this.textStarted) {
          this.writeChunk({ type: 'text-start', id: 'answer' });
          this.textStarted = true;
        }
        this.writeChunk({ type: 'text-delta', id: 'answer', delta: event.text });
        return;
      case 'citation':
        this.writeChunk({
          type: 'data-citation',
          id: event.citationId,
          data: {
            citationId: event.citationId,
            title: event.title,
            snippet: event.snippet,
            location: event.location,
          },
        });
        return;
      case 'run.completed':
        if (this.textStarted) this.writeChunk({ type: 'text-end', id: 'answer' });
        if (event.finishReason === 'cancelled') {
          this.writeChunk({
            type: 'data-agent-status',
            data: { status: 'cancelled', seq: event.seq },
            transient: true,
          });
        }
        this.writeChunk({
          type: 'finish',
          finishReason: event.finishReason === 'cancelled' ? 'other' : 'stop',
        });
        return;
      case 'run.failed':
        this.writeChunk({ type: 'error', errorText: event.message });
    }
  }
}
```

- [ ] **步骤 4：实现活动运行注册表并用单元测试验证幂等取消与清理**

```ts
// apps/api/src/chat/active-run.registry.ts
import { ConflictException, Injectable } from '@nestjs/common';

@Injectable()
export class ActiveRunRegistry {
  private readonly controllers = new Map<string, AbortController>();

  start(requestId: string): AbortController {
    if (this.controllers.has(requestId)) {
      throw new ConflictException('REQUEST_ALREADY_RUNNING');
    }
    const controller = new AbortController();
    this.controllers.set(requestId, controller);
    return controller;
  }

  abort(requestId: string): void {
    this.controllers.get(requestId)?.abort();
  }

  finish(requestId: string): void {
    this.controllers.delete(requestId);
  }
}
```

测试必须覆盖：重复 `start` 返回 409 异常；两次 `abort` 不抛错；`finish` 后同一 request ID 可重新开始。

- [ ] **步骤 5：定义请求校验**

```ts
// apps/api/src/chat/chat.request.ts
import { z } from 'zod';

export const chatRequestSchema = z.object({
  id: z.string().min(1),
  requestId: z.string().uuid(),
  selectedSpaceIds: z.array(z.string().uuid()).max(20).default([]),
  messages: z.array(
    z.object({
      id: z.string(),
      role: z.enum(['user', 'assistant', 'system']),
      parts: z.array(z.unknown()),
    }),
  ).min(1),
});
```

- [ ] **步骤 6：实现 NestJS ChatController**

```ts
// apps/api/src/chat/chat.controller.ts
import { randomUUID } from 'node:crypto';
import { Controller, Inject, Param, Post, Req, Res } from '@nestjs/common';
import {
  createUIMessageStream,
  pipeUIMessageStreamToResponse,
} from 'ai';
import type { RagUIMessage } from '@rag/contracts';
import type { Request, Response } from 'express';
import { AI_EVENT_SOURCE, type AiEventSource } from '../ai/ai-event-source';
import { AiStreamMapper } from '../ai/ai-stream.mapper';
import { ActiveRunRegistry } from './active-run.registry';
import { chatRequestSchema } from './chat.request';

@Controller('chat')
export class ChatController {
  constructor(
    @Inject(AI_EVENT_SOURCE) private readonly ai: AiEventSource,
    private readonly activeRuns: ActiveRunRegistry,
  ) {}

  @Post('stream')
  async stream(@Req() req: Request, @Res() res: Response): Promise<void> {
    const body = chatRequestSchema.parse(req.body);
    const lastUser = [...body.messages].reverse().find(message => message.role === 'user');
    const question = (lastUser?.parts as Array<{ type?: string; text?: string }>)
      .filter(part => part.type === 'text')
      .map(part => part.text ?? '')
      .join('');
    const abort = this.activeRuns.start(body.requestId);
    req.once('aborted', () => abort.abort());
    res.once('close', () => {
      if (!res.writableEnded) abort.abort();
    });

    const stream = createUIMessageStream<RagUIMessage>({
      execute: async ({ writer }) => {
        const mapper = new AiStreamMapper(chunk => writer.write(chunk));
        try {
          for await (const event of this.ai.run(
            {
              requestId: body.requestId,
              traceId: req.header('x-trace-id') ?? randomUUID(),
              actorId: 'foundation-user',
              question,
              selectedSpaceIds: body.selectedSpaceIds,
            },
            abort.signal,
          )) {
            mapper.write(event);
          }
        } catch (error) {
          if (!abort.signal.aborted) throw error;
        } finally {
          this.activeRuns.finish(body.requestId);
        }
      },
      onError: () => 'AI stream failed',
    });

    pipeUIMessageStreamToResponse({ response: res, stream });
  }

  @Post(':requestId/cancel')
  async cancel(@Param('requestId') requestId: string): Promise<{ status: string }> {
    this.activeRuns.abort(requestId);
    await this.ai.cancel(requestId);
    return { status: 'cancelling' };
  }
}
```

```ts
// apps/api/src/chat/chat.module.ts
import { Module } from '@nestjs/common';
import { AI_EVENT_SOURCE } from '../ai/ai-event-source';
import { PythonAiClient } from '../ai/python-ai.client';
import { ActiveRunRegistry } from './active-run.registry';
import { ChatController } from './chat.controller';

@Module({
  controllers: [ChatController],
  providers: [
    ActiveRunRegistry,
    PythonAiClient,
    { provide: AI_EVENT_SOURCE, useExisting: PythonAiClient },
  ],
})
export class ChatModule {}
```

在 `AppModule` 导入 `ChatModule`。

- [ ] **步骤 7：写 controller 契约测试**

使用一个实现 `AiEventSource` 的测试 fake，断言：

```ts
expect(response.headers['x-vercel-ai-ui-message-stream']).toBe('v1');
expect(response.text).toContain('"type":"data-citation"');
expect(response.text).toContain('data: [DONE]');
```

测试请求必须使用固定 `requestId`，并断言 fake 收到相同 request ID。

- [ ] **步骤 8：运行 API 测试和构建**

运行：

```bash
pnpm --filter @rag/api test
pnpm --filter @rag/api typecheck
pnpm --filter @rag/api build
```

预期：全部通过。

- [ ] **步骤 9：提交流适配**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat: bridge ai events to ui message stream"
```

### 任务 6：建立 React + Vercel AI SDK UI 聊天页

**文件：**

- 新建：`apps/web/*`（Vite）
- 新建：`apps/web/src/features/chat/chat-transport.ts`
- 新建：`apps/web/src/features/chat/chat-page.tsx`
- 新建：`apps/web/src/features/chat/message-part.tsx`
- 新建：`apps/web/src/features/chat/message-part.spec.tsx`
- 新建：`apps/web/src/test/setup.ts`
- 修改：`apps/web/src/App.tsx`
- 修改：`apps/web/vite.config.ts`

- [ ] **步骤 1：创建 Vite React 应用并安装依赖**

运行：

```bash
pnpm create vite@9.1.1 apps/web --template react-ts
pnpm --filter ./apps/web add ai@7.0.31 @ai-sdk/react@4.0.34 @rag/contracts@workspace:* zod
pnpm --filter ./apps/web add -D vitest jsdom @testing-library/react @testing-library/jest-dom
```

将 `apps/web/package.json` 的 `name` 改为 `@rag/web`，并加入：

```json
{
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

在 `apps/web/src/test/setup.ts` 写入：

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **步骤 2：先写 message part 失败测试**

```tsx
// apps/web/src/features/chat/message-part.spec.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MessagePart } from './message-part';

describe('MessagePart', () => {
  it('renders a citation as a button without internal storage data', () => {
    render(
      <MessagePart
        part={{
          type: 'data-citation',
          id: 'citation-1',
          data: {
            citationId: 'citation-1',
            title: '制度文档',
            snippet: '证据摘要',
            location: { page: 2 },
          },
        }}
      />,
    );
    expect(screen.getByRole('button', { name: /制度文档/ })).toBeInTheDocument();
    expect(screen.queryByText(/MinIO|ACL/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **步骤 3：运行测试并确认组件缺失**

运行：`pnpm --filter @rag/web test`

预期：失败，找不到 `./message-part`。

- [ ] **步骤 4：实现类型化 data parts 渲染**

```tsx
// apps/web/src/features/chat/message-part.tsx
import type { RagUIMessage } from '@rag/contracts';

type RagMessagePart = RagUIMessage['parts'][number];

export function MessagePart({ part }: { part: RagMessagePart }) {
  if (part.type === 'text') return <span>{part.text}</span>;
  if (part.type !== 'data-citation') {
    return null;
  }
  return (
    <button type="button" data-citation-id={part.data.citationId}>
      [{part.data.title}
      {part.data.location.page ? ` · 第 ${part.data.location.page} 页` : ''}]
    </button>
  );
}
```

- [ ] **步骤 5：实现自定义 Transport**

```ts
// apps/web/src/features/chat/chat-transport.ts
import { DefaultChatTransport } from 'ai';

export function createChatTransport() {
  return new DefaultChatTransport({
    api: '/api/chat/stream',
    headers: () => ({
      'x-chat-protocol-version': '1',
      'x-trace-id': crypto.randomUUID(),
    }),
    prepareSendMessagesRequest: ({ id, messages }) => ({
      body: {
        id,
        requestId: crypto.randomUUID(),
        selectedSpaceIds: [],
        messages,
      },
    }),
  });
}
```

- [ ] **步骤 6：实现聊天页**

```tsx
// apps/web/src/features/chat/chat-page.tsx
import { useMemo, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import type { RagUIMessage } from '@rag/contracts';
import { createChatTransport } from './chat-transport';
import { MessagePart } from './message-part';

export function ChatPage() {
  const transport = useMemo(() => createChatTransport(), []);
  const [input, setInput] = useState('');
  const [agentStatus, setAgentStatus] = useState<string>();
  const { messages, sendMessage, status, stop, error } = useChat<RagUIMessage>({
    transport,
    onData: part => {
      if (part.type === 'data-agent-status') setAgentStatus(part.data.status);
    },
  });

  return (
    <main>
      <h1>企业知识问答</h1>
      <small aria-live="polite">{agentStatus}</small>
      <section aria-label="对话">
        {messages.map(message => (
          <article key={message.id} data-role={message.role}>
            {message.parts.map((part, index) => (
              <MessagePart key={`${message.id}-${index}`} part={part} />
            ))}
          </article>
        ))}
      </section>
      {error ? <p role="alert">{error.message}</p> : null}
      <form
        onSubmit={event => {
          event.preventDefault();
          const text = input.trim();
          if (!text) return;
          void sendMessage({ text });
          setInput('');
        }}
      >
        <label>
          问题
          <textarea value={input} onChange={event => setInput(event.target.value)} />
        </label>
        <button type="submit" disabled={status === 'streaming'}>
          发送
        </button>
        <button type="button" onClick={() => void stop()} disabled={status !== 'streaming'}>
          停止生成
        </button>
      </form>
    </main>
  );
}
```

将 `App.tsx` 改为只渲染 `<ChatPage />`。

- [ ] **步骤 7：配置 Vite 代理**

```ts
// apps/web/vite.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false,
        rewrite: path => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
```

- [ ] **步骤 8：运行 Web 测试、类型检查和构建**

运行：

```bash
pnpm --filter @rag/web test
pnpm --filter @rag/web typecheck
pnpm --filter @rag/web build
```

预期：全部通过。

- [ ] **步骤 9：提交 Web 聊天页**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat: add ai sdk chat interface"
```

### 任务 7：验证真实三进程流、取消和缓冲边界

**文件：**

- 新建：`scripts/smoke-chat.mjs`
- 新建：`apps/api/test/chat-python.e2e-spec.ts`
- 新建：`apps/api/src/chat/chat-protocol.guard.ts`
- 新建：`apps/api/src/chat/chat-protocol.guard.spec.ts`
- 修改：`package.json`
- 修改：`services/ai/tests/test_runs.py`

- [ ] **步骤 1：写 smoke 脚本**

```js
// scripts/smoke-chat.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const requestId = randomUUID();
const response = await fetch('http://127.0.0.1:3000/chat/stream', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-chat-protocol-version': '1',
    'x-trace-id': `smoke-${requestId}`,
  },
  body: JSON.stringify({
    id: 'smoke-conversation',
    requestId,
    selectedSpaceIds: [],
    messages: [
      {
        id: 'smoke-user-message',
        role: 'user',
        parts: [{ type: 'text', text: '验证流式协议' }],
      },
    ],
  }),
});

assert.equal(response.status, 200);
assert.equal(response.headers.get('x-vercel-ai-ui-message-stream'), 'v1');
const body = await response.text();
assert.match(body, /text-delta/);
assert.match(body, /data-citation/);
assert.match(body, /data: \[DONE\]/);
console.log('Chat stream smoke test passed.');
```

- [ ] **步骤 2：分别启动服务并运行 smoke**

终端 A：

```bash
pnpm dev:ai
```

终端 B：

```bash
pnpm dev:api
```

终端 C：

```bash
pnpm smoke:chat
```

预期：终端 C 输出 `Chat stream smoke test passed.`。

- [ ] **步骤 3：添加取消传播测试**

在 `services/ai/tests/test_runs.py` 添加一个慢流测试：读取第一条 `text.delta` 后调用取消端点，继续读取时最后一个事件必须为：

```json
{"type":"run.completed","finishReason":"cancelled"}
```

在 API e2e 测试中使用可观察 fake `AiEventSource`，分别验证浏览器断开和显式 `POST /chat/:requestId/cancel`：

```ts
expect(fake.lastSignal?.aborted).toBe(true);
```

浏览器断开测试通过 `request.destroy()` 模拟，并等待注册表清理后断言同一 request ID 可以再次开始。

- [ ] **步骤 4：添加协议版本拒绝测试**

向 `/chat/stream` 发送 `x-chat-protocol-version: 0`。

预期：

```json
{
  "statusCode": 409,
  "code": "CHAT_PROTOCOL_VERSION_UNSUPPORTED",
  "supportedVersion": "1"
}
```

实现 `ChatProtocolGuard`，只允许请求头精确等于 `1`，否则用 `HttpException` 和 409 状态抛出上述精确响应体；把 guard 加入 `ChatModule.providers`，只在 `ChatController.stream` 方法上用 `@UseGuards(ChatProtocolGuard)` 注册，保证在调用 `AiEventSource.run` 前完成校验，同时不阻断幂等取消端点。

- [ ] **步骤 5：运行跨服务和取消测试**

运行：

```bash
pnpm --filter @rag/api test:e2e
uv run --project services/ai pytest services/ai/tests/test_runs.py -q
```

预期：全部通过；取消测试证明 AbortSignal 和 Python cancel event 均被设置。

- [ ] **步骤 6：提交 smoke 和取消保护**

```bash
git add scripts/smoke-chat.mjs apps/api services/ai package.json pnpm-lock.yaml
git commit -m "test: verify streaming and cancellation boundaries"
```

### 任务 8：加入 CI、开发文档和最终验证

**文件：**

- 新建：`.github/workflows/ci.yml`
- 新建：`docs/architecture/001-service-boundaries.md`
- 新建：`docs/architecture/002-streaming-contract.md`
- 新建：`docs/development/quickstart.md`
- 修改：`README.md`

- [ ] **步骤 1：编写 CI**

```yaml
# .github/workflows/ci.yml
name: ci

on:
  pull_request:
  push:
    branches: [master, main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11.14.0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - uses: astral-sh/setup-uv@v6
        with:
          version: "0.11.29"
          enable-cache: true
      - run: pnpm install --frozen-lockfile
      - run: uv sync --project services/ai --frozen
      - run: pnpm check:workspace
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
```

- [ ] **步骤 2：记录服务边界**

`docs/architecture/001-service-boundaries.md` 必须明确：

- 浏览器只访问 NestJS。
- NestJS 是身份、ACL、引用重新鉴权和外部协议真相源。
- Python 只接受 NestJS 内部调用。
- Python 输出 `application/x-ndjson`，NestJS 输出 AI SDK UI Message Stream。
- 本计划中的 `foundation-user` 仅为骨架占位身份，在计划 1 必须被真实认证主体替换。

- [ ] **步骤 3：记录流、背压和取消**

`docs/architecture/002-streaming-contract.md` 必须包含以下确定规则：

```text
Python NDJSON 单条记录最大 64 KiB。
NestJS 只在处理完当前 AgentEvent 后读取下一条记录。
事件 seq 从 0 连续递增；缺号、重复或乱序立即终止流。
浏览器断开触发 NestJS AbortController。
NestJS AbortController 中止 Python fetch，并调用幂等 cancel endpoint。
Python 生成器在下一次 yield 前检查 cancel event。
NestJS 不向浏览器发送模型思维链。
```

- [ ] **步骤 4：编写快速启动文档**

`docs/development/quickstart.md` 使用三个终端给出准确命令：

```bash
pnpm install
uv sync --project services/ai
pnpm dev:ai
pnpm dev:api
pnpm dev:web
```

并说明端口：

```text
Web: http://127.0.0.1:5173
API: http://127.0.0.1:3000
AI:  http://127.0.0.1:8001
```

- [ ] **步骤 5：运行完整验证**

运行：

```bash
pnpm check:workspace
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

预期：

- workspace 检查通过。
- TypeScript 和 Python lint/typecheck 零错误。
- contracts、API、Web、Python 测试全部通过。
- Web、API 和 Python wheel 构建成功。

- [ ] **步骤 6：确认工作区只包含计划内文件**

运行：

```bash
git status --short
git diff --check
```

预期：只显示本任务的 CI、README 和文档文件；`git diff --check` 无输出。

- [ ] **步骤 7：提交 CI 与文档**

```bash
git add .github README.md docs package.json pnpm-lock.yaml
git commit -m "docs: add development and streaming architecture guide"
```

## 计划 0 完成检查

- [ ] 根 workspace 和 lockfile 已提交。
- [ ] TypeScript 与 Python 共同校验同一 JSONL fixture。
- [ ] Python 流具有严格递增 sequence 和 64 KiB 单记录上限。
- [ ] NestJS 使用 AI SDK UI Message Stream，不直接调用云模型。
- [ ] 浏览器引用数据不包含 ACL、用户、组、MinIO 键或直链。
- [ ] 浏览器停止或断开能够取消 NestJS 和 Python 运行。
- [ ] 三进程 smoke 测试通过。
- [ ] CI 的 lint、typecheck、test、build 全部通过。
- [ ] 计划 1 开始前，将 `foundation-user` 替换路径列为首个身份接入测试。
