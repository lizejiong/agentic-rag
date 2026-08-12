# 空间与文档工作流改造实施计划

> **给 agentic workers：** 必须使用 `superpowers:executing-plans` 按任务逐项执行本计划。步骤使用 checkbox（`- [ ]`）语法跟踪状态。

**目标：** 将登录/加载界面、空间与文档管理改造成统一的蓝白管理端体验，并使资源写操作完成后可靠刷新对应数据。

**架构：** 新建一个可复用的空间页签组件，所有空间子页面共享同一导航且包含知识图谱。以右侧抽屉承载创建、导入与文档详情；空间删除使用受权限保护的后端软归档接口，文档批量删除在前端并发调用现有软删除接口。TanStack Query 在每个成功写操作后失效空间、列表和详情缓存。

**技术栈：** React 19、React Router、TanStack Query、Tailwind CSS、NestJS、Prisma、Vitest、Jest e2e。

---

### 任务 1：补齐空间删除 API 与回归测试

**文件：**
- 修改：`apps/api/src/spaces/spaces.controller.ts`
- 修改：`apps/api/src/spaces/spaces.service.ts`
- 修改：`apps/api/test/spaces.e2e-spec.ts`
- 修改：`apps/web/src/features/spaces/spaces-api.ts`

- [ ] **步骤 1：编写 API e2e 断言**

在 `spaces.e2e-spec.ts` 创建并重新激活测试空间后加入：

```ts
await request(server)
  .delete(`/spaces/${createdSpace.id}`)
  .set('authorization', `Bearer ${adminToken}`)
  .expect(204);
await request(server)
  .get('/spaces')
  .set('authorization', `Bearer ${adminToken}`)
  .expect(200)
  .expect(({ body }) => expect(body).not.toContainEqual(expect.objectContaining({ id: createdSpace.id })));
```

- [ ] **步骤 2：运行测试并确认失败**

运行：`pnpm --filter @rag/api test:e2e -- spaces.e2e-spec.ts`

预期：`DELETE /spaces/:id` 返回 404。

- [ ] **步骤 3：实现管理权限下的归档删除**

在 controller 添加 `@Delete(':id')` 和 `@HttpCode(204)`，服务实现 `delete(user, id)`：先 `policy.require(user, id, 'MANAGE')`，再以 `revision.mutate` 将 `knowledgeSpace.status` 更新为 `ARCHIVED`；审计 action 为 `space.delete`、eventType 为 `space.deleted`。前端 API 添加：

```ts
export async function deleteSpace(fetcher: Fetcher, spaceId: string): Promise<void> {
  const response = await fetcher(`/api/spaces/${spaceId}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(`DELETE_SPACE_HTTP_${response.status}`);
}
```

- [ ] **步骤 4：运行测试并确认通过**

运行：`pnpm --filter @rag/api test:e2e -- spaces.e2e-spec.ts`

预期：测试通过，删除空间不再出现在可见空间列表。

### 任务 2：建立抽屉、空间页签与空间管理交互

**文件：**
- 新建：`apps/web/src/components/ui/side-panel.tsx`
- 新建：`apps/web/src/features/spaces/space-tabs.tsx`
- 修改：`apps/web/src/features/spaces/spaces-page.tsx`
- 修改：`apps/web/src/features/spaces/space-overview-page.tsx`
- 修改：`apps/web/src/features/spaces/space-members-page.tsx`
- 修改：`apps/web/src/features/graph/graph-page.tsx`

- [ ] **步骤 1：创建通用侧边抽屉**

实现带遮罩、关闭按钮、`Escape` 键关闭和 `role="dialog"` 的 `SidePanel`。其 API 为：

```tsx
export function SidePanel({ open, title, children, onClose }: {
  open: boolean; title: string; children: ReactNode; onClose: () => void;
}) { /* fixed right drawer */ }
```

- [ ] **步骤 2：创建空间页签**

根据当前 `useLocation().pathname` 标记活动项，始终渲染概览、文档、知识图谱，只有 `MANAGE` 时增加成员与权限：

```tsx
<SpaceTabs spaceId={spaceId} canManage={space?.effectivePermission === 'MANAGE'} />
```

- [ ] **步骤 3：将空间创建改为抽屉，并添加删除操作**

移除 `SpacesPage` 中内嵌 `Card` 表单，将名称和描述表单放进 `SidePanel`。每次创建或删除成功后执行：

```ts
await queryClient.invalidateQueries({ queryKey: visibleSpacesQueryKey });
```

仅管理员在每个空间卡片提供“删除”按钮；按钮须阻止 `Link` 导航，使用确认框后调用 `deleteSpace`。

- [ ] **步骤 4：压缩空间子页标题并共享页签**

删除概览、文档、成员与图谱页中重复的大号空间名和描述区块；保留简短面包屑和共享 `SpaceTabs`。图谱页面也必须呈现页签，保证用户可从图谱切换回其他子页。

- [ ] **步骤 5：让四个开关保存后重新请求**

将 `SpaceOverviewPage` 的 `onSuccess` 改为等待失效：

```ts
onSuccess: async () => {
  await queryClient.invalidateQueries({ queryKey: visibleSpacesQueryKey });
}
```

每个开关使用服务器重新取得的数据渲染，不进行乐观本地覆盖。

### 任务 3：把导入改为抽屉，并将文档详情嵌入右侧栏

**文件：**
- 新建：`apps/web/src/features/documents/document-detail-panel.tsx`
- 修改：`apps/web/src/features/documents/document-list-page.tsx`
- 修改：`apps/web/src/features/documents/document-upload-panel.tsx`
- 修改：`apps/web/src/features/documents/document-url-import-panel.tsx`
- 修改：`apps/web/src/features/documents/document-detail-page.tsx`
- 修改：`apps/web/src/app/app-router.tsx`

- [ ] **步骤 1：提取可嵌入的文档详情**

将详情内容提取为 `DocumentDetailPanel({ documentId, onClose, onChanged })`；打开后立即请求文档详情、解析内容和 chunks。已解析内容和 chunks 列表容器均使用 `max-h-80 overflow-auto`，不再要求用户点击“查看内容”。

- [ ] **步骤 2：将下载、替换、删除移至列表操作列**

列表的“查看”按钮只调用 `setSelectedDocumentId(document.id)` 打开抽屉。可编辑用户看见下载、替换、删除；替换成功或删除成功后调用：

```ts
await queryClient.invalidateQueries({ queryKey: ['spaces', spaceId, 'documents'] });
await queryClient.invalidateQueries({ queryKey: ['document', documentId] });
```

详情抽屉不渲染这三个资源修改按钮。

- [ ] **步骤 3：将上传文件和网页导入放进抽屉**

上传和 URL 导入按钮应分别打开 `SidePanel`，面板成功入队后关闭抽屉并触发当前文档查询 `refetch()`；不再在表格上方展开表单。

- [ ] **步骤 4：删除独立详情导航**

路由 `/documents/:documentId` 保留为向后兼容重定向至其空间的文档列表（附带已选文档状态）；不再显示独立全页详情，也不让任何页面链接到该路由。

### 任务 4：实现批量删除与写操作后的统一刷新

**文件：**
- 修改：`apps/web/src/features/documents/document-list-page.tsx`
- 修改：`apps/web/src/features/documents/document-upload-panel.tsx`
- 修改：`apps/web/src/features/documents/document-url-import-panel.tsx`
- 修改：`apps/web/src/features/spaces/space-members-page.tsx`

- [ ] **步骤 1：为文档表格增加选择与批量删除**

首列加入全选 checkbox 和每行 checkbox。仅在 `canEdit` 且选中至少一项时显示“批量删除（N）”；确认后并发调用：

```ts
await Promise.all(selectedIds.map((id) => deleteDocument(auth.authorizedFetch, id)));
setSelectedIds([]);
await documentsQuery.refetch();
```

- [ ] **步骤 2：处理部分失败**

使用 `Promise.allSettled`，成功删除后仍刷新列表；若存在 rejected 项，显示失败数并保留失败 ID 的选择，避免误报全部成功。

- [ ] **步骤 3：检查所有写路径的刷新**

创建空间、删除空间、更新空间配置、成员授权、删除授权、文件上传、URL 导入、替换文件、单个删除和批量删除成功后，均显式失效或重新获取对应查询。成员授权更新后同时失效 `['spaces', spaceId, 'detail']` 与 `visibleSpacesQueryKey`。

### 任务 5：统一登录与会话加载页的视觉主题

**文件：**
- 修改：`apps/web/src/features/auth/login-page.tsx`
- 修改：`apps/web/src/app/app-router.tsx`
- 修改：`apps/web/src/styles.css`
- 修改：`apps/web/src/features/auth/login-page.spec.tsx`

- [ ] **步骤 1：更新登录可访问性测试**

保留现有登录标题和表单标签断言，并新增：

```ts
expect(screen.getByRole('main')).toHaveClass('min-h-screen');
```

- [ ] **步骤 2：采用应用壳一致的蓝白样式**

登录页改用 Tailwind 的 `bg-slate-50` 页面背景、`bg-white` 卡片、`bg-blue-700` 品牌标记和主按钮；移除旧 `.login-*` 的深色样式依赖。`SessionLoading` 显示白色卡片、蓝色 spinner 和“正在恢复安全会话”文字，视觉与应用主框架一致。

- [ ] **步骤 3：运行前端测试与类型检查**

运行：`pnpm --filter @rag/web test` 与 `pnpm --filter @rag/web typecheck`

预期：所有 Vitest 用例、TypeScript 构建均通过。

### 任务 6：完整回归验证

**文件：**
- 修改：如测试暴露缺陷，仅修改相关实现或测试文件。

- [ ] **步骤 1：运行 API 空间测试**

运行：`pnpm --filter @rag/api test:e2e -- spaces.e2e-spec.ts`

预期：空间删除、权限与归档测试全部通过。

- [ ] **步骤 2：运行 Web 单测和构建**

运行：`pnpm --filter @rag/web test && pnpm --filter @rag/web build`

预期：测试通过且 Vite 构建成功。

- [ ] **步骤 3：人工核对关键流程**

核对登录与会话加载、空间创建/删除、四项开关刷新、跨页签图谱切换、导入抽屉、文档详情抽屉、下载/替换/删除以及批量删除；每个成功写操作都应反映服务器重新请求后的数据。
