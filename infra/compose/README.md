# 本地数据平台

该 Compose 只启动 Atlas RAG 的中间件。React、NestJS 和 Python 在开发时仍由宿主机进程启动，便于调试和热更新。

## 资源要求

- Docker Desktop 或 Docker Engine 24+
- Docker Compose 2.26+
- 至少 6 GB 可用内存；建议 8 GB
- Elasticsearch 所在 Linux/WSL 环境的 `vm.max_map_count` 至少为 `262144`

## 启动

```powershell
Copy-Item infra/compose/.env.example infra/compose/.env
pnpm infra:up
pnpm infra:ps
pnpm infra:check
```

所有服务仅监听 `127.0.0.1`。默认端口：

| 服务 | 地址 |
|---|---|
| PostgreSQL/pgvector | `127.0.0.1:5432` |
| Elasticsearch | `http://127.0.0.1:9200` |
| Neo4j Browser | `http://127.0.0.1:7474` |
| Neo4j Bolt | `bolt://127.0.0.1:7687` |
| Redis | `127.0.0.1:6379` |
| MinIO API | `http://127.0.0.1:9000` |
| MinIO Console | `http://127.0.0.1:9001` |

`minio-init` 是一次性容器，负责创建私有 bucket；成功退出是正常状态。

## 版本策略

镜像使用精确版本 tag，升级必须经过空卷启动、迁移、备份恢复和项目全量测试。生产环境应进一步固定镜像 digest，并按企业许可证政策确认 Redis Server 与 MinIO 的分发方式。

## 停止

```powershell
pnpm infra:down
```

该命令保留命名卷。除非明确要永久删除本地数据，否则不要使用 `docker compose down -v`。
