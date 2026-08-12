# 空间页面一致性修复实施计划

> **给 agentic workers：** 使用 `superpowers:executing-plans` 逐项执行并验证。
**目标：** 统一空间子页的面包屑与页签头部、确保变更后重新请求，并消除抽屉内外叠加滚动。
**架构：** 将面包屑封装进 `SpaceTabs` 的共享头部；写入成功后使用 `refetch` 取得服务器最新资源；抽屉打开时锁定 body 滚动，仅保留抽屉主体和内容区域的必要滚动。
**技术栈：** React、TanStack Query、Tailwind CSS。

### 任务 1：统一空间子页头部

**文件：** `apps/web/src/features/spaces/space-tabs.tsx`、`apps/web/src/features/{spaces,graph}/*.tsx`

- [ ] 让 `SpaceTabs` 接收 `spaceName`，在页签之前渲染 `知识空间 / {spaceName} / {当前页}` 面包屑。
- [ ] 删除概览、文档、成员和图谱页面各自的面包屑，只传入当前空间名称与活动页名称，避免图谱遗漏。

### 任务 2：可靠刷新服务器资源

**文件：** `apps/web/src/features/spaces/space-overview-page.tsx`、`apps/web/src/features/spaces/spaces-page.tsx`

- [ ] 功能开关 mutation 成功后先失效空间缓存，再调用 `spacesQuery.refetch()`。
- [ ] 删除空间成功后失效 `visibleSpacesQueryKey` 并调用 `spacesQuery.refetch()`，以服务器返回的完整空间列表渲染。

### 任务 3：优化抽屉滚动和文档详情

**文件：** `apps/web/src/components/ui/side-panel.tsx`、`apps/web/src/features/documents/document-detail-panel.tsx`、`apps/web/src/features/documents/document-list-page.tsx`

- [ ] 侧边栏打开时将 `document.body.style.overflow` 设为 `hidden`，关闭及卸载时恢复原值。
- [ ] 抽屉主体只承担一层纵向滚动；内容卡片取消自身 `overflow-hidden`，仅解析内容与 Chunks 的数据区使用同样的 `max-h-72 overflow-y-auto` 滚动样式。
- [ ] 移除内容区域重复的“文档详情”文字；操作列的查看、下载、替换、删除全部显示文字按钮。

### 任务 4：验证

- [ ] 运行 `pnpm --filter @rag/web typecheck`，预期 TypeScript 通过。
