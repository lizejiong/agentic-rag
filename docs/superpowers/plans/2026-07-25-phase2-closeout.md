# Phase 2 收尾计划

> **前置：** 计划 2 核心交付（文件上传、URL 导入、解析管道、版本管理、详情页）已完成。
> **执行方式：** 使用 `superpowers:executing-plans`，TDD，每任务独立提交。

## 已完成（核心交付）

- [x] 多格式文件上传（最多 100 个并发 3）与 URL 导入
- [x] 安全扫描（ClamAV）、文件校验、解析管道（Docling）
- [x] 文档版本管理、原子发布
- [x] 文档详情页（元信息、版本历史、解析内容查看、原文件下载）
- [x] 文档列表页（名称、类型、大小、状态、进度、URL 刷新）
- [x] 软删除服务层（`AuthorizationService.setDocumentAvailability`），需 MANAGE 权限
- [x] 所有查询端点和列表已过滤 `SOFT_DELETED` 文档
- [x] 自动故障恢复（`DocumentReconciliationService`，每 5 分钟检测 stalled 任务并重放）

---

## 已完成（收尾，2026-07-26）

### 任务 1：文档删除 Controller + 级联清理

**完成情况：** 已提供删除端点与前端入口；删除会同步清理 `rag` 侧索引数据并保留权限、审计与 revision 语义。

**步骤：**

- [x] **步骤 1：新增 `DELETE /documents/:documentId` 端点**
  - `DocumentsController` 新增路由
  - `DocumentsService.delete()` 调用 `AuthorizationService.setDocumentAvailability(user, documentId, 'SOFT_DELETED')`
  
- [x] **步骤 2：级联清理 rag schema**
  - 软删除后清理 `rag.chunks`、`rag.chunk_embeddings`、`rag.normalized_elements`、`rag.normalized_documents`（通过出队事件或直接 SQL）
  - 或发布 `document.deleted` 事件由 Python worker 消费执行清理

- [x] **步骤 3：前端删除按钮**
  - 详情页「删除文档」按钮，需确认对话框
  - 仅 MANAGE 权限可见

- [x] **步骤 4：测试**
  - API 测试：删除成功、权限拒绝、已删除文档不可访问
  - 验证 `rag` schema 清理完整

### 任务 2：文档列表搜索与筛选

**完成情况：** 文档列表已支持标题搜索与处理状态筛选，并由 API 与前端共同暴露。

**步骤：**

- [x] **步骤 1：list() 加 query 参数**
  - `search?: string`（标题模糊匹配）
  - `status?: string`（processingStatus 筛选）
  - 使用 Prisma `contains` + `where` 条件

- [x] **步骤 2：Controller 接收 query params**
  - `@Query('search')`、`@Query('status')`

- [x] **步骤 3：前端搜索框 + 状态筛选下拉**
  - 列表页顶部加搜索输入框和状态下拉

- [x] **步骤 4：测试**
  - API 测试：搜索匹配、空结果、状态筛选

### 任务 3：Chunk 列表 API

**完成情况：** 已提供受授权保护的 Chunk 列表 API 与详情页展示。

**步骤：**

- [x] **步骤 1：新增 `GET /documents/:documentId/chunks` 端点**
  - `DocumentsService.getChunks()` 查询 `rag.chunks WHERE version_id = activeVersionId`
  - 返回：chunk_index、content、token_count、location（page/slide/sheet）

- [x] **步骤 2：Contract schema**
  - 新增 `documentChunkSchema` 和 `documentChunkListSchema`

- [x] **步骤 3：前端 Chunk 列表展示**
  - 详情页「Chunk 列表」section
  - 显示 chunk 序号、文本预览、token 数、位置信息

- [x] **步骤 4：测试**

### 任务 4：文件替换上传

**完成情况：** FILE 类型已支持以新版本方式替换上传。

**步骤：**

- [x] **步骤 1：新增 `POST /documents/:documentId/replace-file` 端点**
  - 复用 `refreshUrl` 模式：创建新 version（versionNumber+1）、新 importTask
  - 验证 document 类型为 FILE

- [x] **步骤 2：前端替换按钮**
  - 详情页「替换文件」按钮（仅 EDIT 权限可见）
  - 复用上传面板组件

- [x] **步骤 3：测试**

### 任务 5：失败重试端点

**完成情况：** 已提供 FAILED 导入的用户触发重试入口，并保留自动恢复机制。

**步骤：**

- [x] **步骤 1：新增 `POST /imports/:importId/retry` 端点**
  - 验证任务状态为 FAILED
  - 重置状态为 PENDING_UPLOAD（文件导入）或重新入队（ingestion 失败）
  - 权限校验：EDIT 以上

- [x] **步骤 2：前端重试按钮**
  - 详情页失败文档旁显示「重试」按钮

- [x] **步骤 3：测试**

### 任务 6：知识空间文档统计

**完成情况：** 空间列表已包含未软删除文档的统计，并在前端展示。

**步骤：**

- [x] **步骤 1：`SpacePolicy.listVisible()` 加 Prisma `_count`**
  - `_count: { select: { documents: { where: { availability: { not: 'SOFT_DELETED' } } } } }`
  - 可选：按 processingStatus 分组统计

- [x] **步骤 2：前端展示**
  - 空间侧边栏显示文档数量

- [x] **步骤 3：测试**

### 任务 7：上传人显示

**完成情况：** 已仅暴露上传人 `username`，不暴露内部 `createdById`。

**步骤：**

- [x] **步骤 1：list() 和 get() select 中 include `createdBy: { select: { username: true } }`**
  - 更新 contract schema：新增 `createdBy?: { username: string }`

- [x] **步骤 2：更新测试**
  - 修改 `documents.service.spec.ts:136` 的 assert：允许 `createdBy`，但仍拒绝 `createdById`

- [x] **步骤 3：前端展示**
  - 文档列表卡片和详情页显示上传人用户名

- [x] **步骤 4：测试**

---

## 出口

- [x] 文档可被软删除，删除后所有 API 返回 404，Chunk/向量同步清理
- [x] 文档列表支持按标题搜索和按状态筛选
- [x] 文档详情页展示 Chunk 列表（序号、文本、token 数、位置）
- [x] FILE 类型文档可替换上传新版本
- [x] 失败文档可通过按钮手动重试
- [x] 知识空间列表展示文档总数
- [x] 文档卡片显示上传人用户名
