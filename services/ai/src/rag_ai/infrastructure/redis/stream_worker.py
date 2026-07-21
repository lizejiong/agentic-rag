from __future__ import annotations

from dataclasses import dataclass

from redis.asyncio import Redis
from redis.exceptions import ResponseError


@dataclass(frozen=True)
class StreamMessage:
    message_id: str
    fields: dict[str, str]


class RedisStreamTransport:
    def __init__(self, client: Redis, stream: str, group: str, consumer: str) -> None:
        self._client = client
        self._stream = stream
        self._group = group
        self._consumer = consumer

    async def ensure_group(self) -> None:
        try:
            await self._client.xgroup_create(self._stream, self._group, id="0", mkstream=True)
        except ResponseError as error:
            if "BUSYGROUP" not in str(error):
                raise

    async def read(self, *, count: int, block_milliseconds: int) -> list[StreamMessage]:
        response = await self._client.xreadgroup(
            self._group,
            self._consumer,
            {self._stream: ">"},
            count=count,
            block=block_milliseconds,
        )
        messages: list[StreamMessage] = []
        for _stream_name, entries in response:
            for message_id, fields in entries:
                messages.append(StreamMessage(message_id=message_id, fields=fields))
        return messages

    async def claim_stale(self, *, count: int, min_idle_milliseconds: int) -> list[StreamMessage]:
        response = await self._client.xautoclaim(
            self._stream,
            self._group,
            self._consumer,
            min_idle_milliseconds,
            start_id="0-0",
            count=count,
        )
        if not isinstance(response, (list, tuple)) or len(response) < 2:
            return []
        entries = response[1]
        if not isinstance(entries, list):
            return []
        return [
            StreamMessage(message_id=message_id, fields=fields) for message_id, fields in entries
        ]

    async def acknowledge(self, message_id: str) -> None:
        await self._client.xack(self._stream, self._group, message_id)

    async def publish(self, stream: str, envelope: str) -> str:
        return await self._client.xadd(stream, {"envelope": envelope})

    async def close(self) -> None:
        await self._client.aclose()


def create_redis_transport(
    redis_url: str, stream: str, group: str, consumer: str
) -> RedisStreamTransport:
    client: Redis = Redis.from_url(redis_url, decode_responses=True)
    return RedisStreamTransport(client, stream, group, consumer)
