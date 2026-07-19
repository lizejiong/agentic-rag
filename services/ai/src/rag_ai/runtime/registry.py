import asyncio
from uuid import UUID


class RunAlreadyActiveError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("REQUEST_ALREADY_RUNNING")


class RunRegistry:
    def __init__(self) -> None:
        self._events: dict[UUID, asyncio.Event] = {}

    def acquire(self, request_id: UUID) -> asyncio.Event:
        if request_id in self._events:
            raise RunAlreadyActiveError()
        event = asyncio.Event()
        self._events[request_id] = event
        return event

    def cancel(self, request_id: UUID) -> None:
        event = self._events.get(request_id)
        if event is not None:
            event.set()

    def release(self, request_id: UUID, event: asyncio.Event) -> None:
        if self._events.get(request_id) is event:
            self._events.pop(request_id)


run_registry = RunRegistry()
