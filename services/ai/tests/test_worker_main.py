from __future__ import annotations

import asyncio

import pytest

from rag_ai import worker_main


def test_worker_uses_selector_event_loop_on_windows(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(worker_main.sys, "platform", "win32")

    loop = worker_main._worker_loop_factory()
    try:
        assert isinstance(loop, asyncio.SelectorEventLoop)
    finally:
        loop.close()
