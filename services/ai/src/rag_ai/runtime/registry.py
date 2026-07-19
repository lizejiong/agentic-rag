import asyncio
from uuid import UUID


class RunRegistry:
    def __init__(self) -> None:
        self._events: dict[UUID, asyncio.Event] = {}

    def event_for(self, request_id: UUID) -> asyncio.Event:
        return self._events.setdefault(request_id, asyncio.Event())

    def cancel(self, request_id: UUID) -> None:
        event = self._events.get(request_id)
        if event is not None:
            event.set()

    def release(self, request_id: UUID) -> None:
        self._events.pop(request_id, None)


run_registry = RunRegistry()
