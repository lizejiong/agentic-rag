# 聊天页重构实施计划

> **执行方式：** 使用 `superpowers:executing-plans` 在独立工作区逐项执行；每完成一个任务运行对应测试。

**目标：** 将当前聊天页重构为 ChatGPT 风格、以对话内容为中心、可稳定选择知识范围、请求失败不白屏的 PC 工作区。

**架构：** 保留 `useChat`、`/api/chat/stream` 和浏览器内临时会话，不新增会话持久化。左侧保留紧凑会话导航；右侧拆成输入框上方的知识范围选择、内部滚动消息区和固定输入区。用户消息右对齐使用浅色气泡，助手消息左对齐不使用大色块；引用统一收纳在回答下方。聊天面板使用局部错误边界，网络错误在输入区呈现并允许继续提问。

**技术栈：** React 19、React Router、Vercel AI SDK UI、TanStack Query、Tailwind CSS、Vitest、Testing Library。

---

### 任务 1：建立聊天工作区的状态边界

**文件：**
- 新建：`apps/web/src/features/chat/chat-workspace-error-boundary.tsx`
- 新建：`apps/web/src/features/chat/chat-workspace-error-boundary.spec.tsx`
- 修改：`apps/web/src/features/chat/chat-page.tsx`

- [ ] **步骤 1：写失败测试，验证局部渲染异常不会清空应用壳。**

```tsx
render(
  <ChatWorkspaceErrorBoundary>
    <ThrowingChatPanel />
  </ChatWorkspaceErrorBoundary>,
);

expect(screen.getByRole('alert')).toHaveTextContent('聊天页面暂时无法显示');
expect(screen.getByRole('button', { name: '重新加载聊天区' })).toBeEnabled();
```

- [ ] **步骤 2：运行测试并确认失败。**

Run: `pnpm.cmd --filter @rag/web test -- chat-workspace-error-boundary.spec.tsx`

Expected: 测试因组件不存在而失败。

- [ ] **步骤 3：实现局部错误边界和重置按钮。**

```tsx
export class ChatWorkspaceErrorBoundary extends Component<Props, State> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return <section role="alert">聊天页面暂时无法显示<Button onClick={() => this.setState({ hasError: false })}>重新加载聊天区</Button></section>;
    }
    return this.props.children;
  }
}
```

在 `ChatPage` 中仅包裹右侧聊天工作区，顶部导航和会话导航不受影响。

- [ ] **步骤 4：运行测试并确认通过。**

Run: `pnpm.cmd --filter @rag/web test -- chat-workspace-error-boundary.spec.tsx`

Expected: 通过。

### 任务 2：重构页面布局与会话导航

**文件：**
- 修改：`apps/web/src/features/chat/chat-page.tsx`
- 新建：`apps/web/src/features/chat/chat-page.spec.tsx`
- 修改：`apps/web/src/app/pc-app-shell.tsx`

- [ ] **步骤 1：写失败测试，验证初始聊天页默认全选可访问空间，并提供新建会话。**

```tsx
expect(await screen.findByRole('button', { name: '全部可访问空间' })).toBeVisible();
await user.click(screen.getByRole('button', { name: '新建对话' }));
expect(screen.getAllByRole('button', { name: /当前对话/ })).toHaveLength(2);
```

- [ ] **步骤 2：将页面重组为固定高度三段布局。**

右侧仅保留紧凑工具栏、内部滚动消息区、固定输入区；不再放大标题或让页面本身滚动。左侧保留 240px 临时会话栏，当前会话高亮，并明确提示“会话仅在当前浏览器页面有效”。

```tsx
<main className="flex h-full min-h-0 bg-white">
  <ChatSidebar conversations={conversations} onCreate={createConversation} />
  <ChatWorkspaceErrorBoundary>
    <ChatSession className="min-w-0 flex-1" />
  </ChatWorkspaceErrorBoundary>
</main>
```

空间数据到达后，只有当前选择为空时才初始化为全部空间；后续刷新只移除已失效的空间 ID，不能覆盖用户的手动选择。

- [ ] **步骤 3：让应用壳保证聊天路由只在内容面板内部滚动。**

`PcAppShell` 的 `/chat` 分支保持 `h-screen`、`overflow-hidden`，聊天 `main` 使用 `min-h-0 flex-1 overflow-hidden`。

- [ ] **步骤 4：运行页面测试。**

Run: `pnpm.cmd --filter @rag/web test -- chat-page.spec.tsx`

Expected: 默认范围、创建会话和会话切换均通过。

### 任务 3：重做知识范围和消息体验

**文件：**
- 修改：`apps/web/src/features/chat/space-scope-selector.tsx`
- 新建：`apps/web/src/features/chat/space-scope-selector.spec.tsx`
- 修改：`apps/web/src/features/chat/conversation-view.tsx`
- 修改：`apps/web/src/features/chat/message-part.tsx`
- 修改：`apps/web/src/features/chat/chat-composer.tsx`
- 修改：`apps/web/src/features/chat/chat-composer.spec.tsx`

- [ ] **步骤 1：写失败测试，验证范围面板可搜索、全选和清空。**

```tsx
await user.click(screen.getByRole('button', { name: '全部可访问空间' }));
await user.type(screen.getByPlaceholderText('搜索知识空间'), '简历');
expect(screen.getByRole('checkbox', { name: /简历/ })).toBeVisible();
await user.click(screen.getByRole('button', { name: '清空选择' }));
expect(onChange).toHaveBeenLastCalledWith([]);
```

- [ ] **步骤 2：实现紧凑、可检索的空间面板。**

范围控制放在输入卡片底部的独立工具栏，文本输入区始终占满整行。按钮只显示单个空间、`全部空间` 或 `已选 N 个`；点击后从右侧滑出管理抽屉。抽屉包含搜索框、全选、清空、内部滚动列表和固定的“应用”按钮。空会话时将完整输入卡片置于视口中下部，开始聊天后平滑固定到底部。

- [ ] **步骤 3：让消息区只在自身滚动，并在新消息出现时滚动到底部。**

```tsx
const endRef = useRef<HTMLDivElement>(null);
useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [messages]);
```

空状态仅保留一行引导，不提供示例问题；助手流式消息先显示小型加载状态，检索摘要归入可展开“检索详情”，引用使用统一卡片并收纳在回答下方，不占据主要阅读区域。

- [ ] **步骤 4：完善输入区的网络错误和重试提示。**

当 `useChat` 返回错误时，展示“服务连接已中断，请确认 API 服务后重试”，保留用户输入。发送按钮仅因无输入、无知识范围或正在请求而禁用；停止按钮取消当前请求。

- [ ] **步骤 5：运行组件测试。**

Run: `pnpm.cmd --filter @rag/web test -- space-scope-selector.spec.tsx chat-composer.spec.tsx message-part.spec.tsx`

Expected: 范围搜索、选择限制、错误提示和引用卡片全部通过。

### 任务 4：类型检查、浏览器走查与提交

**文件：**
- 修改：`docs/design/pc-web-redesign.md`

- [ ] **步骤 1：更新设计文档。**

在“智能问答”章节记录：聊天面板局部错误边界、范围搜索/清空、内部消息滚动和浏览器内临时会话的边界。

- [ ] **步骤 2：运行前端测试和类型检查。**

Run: `pnpm.cmd --filter @rag/web test`

Expected: 所有 Web 测试通过。

Run: `pnpm.cmd --filter @rag/web typecheck`

Expected: 退出码为 0。

- [ ] **步骤 3：在 `http://127.0.0.1:5173/chat` 走查。**

验证：默认全选、搜索并单选“简历”、新建会话、发送后加载态、停止按钮、断开 API 后的错误提示，以及浏览器无外层纵向滚动条。

- [ ] **步骤 4：提交独立分支。**

```bash
git add apps/web/src/features/chat apps/web/src/app/pc-app-shell.tsx docs/design/pc-web-redesign.md
git commit -m "refactor: rebuild chat workspace"
```

### 任务 5：节流流式消息渲染

**文件：**
- 新建：`apps/web/src/features/chat/use-throttled-messages.ts`
- 新建：`apps/web/src/features/chat/use-throttled-messages.spec.tsx`
- 修改：`apps/web/src/features/chat/chat-page.tsx`
- 修改：`apps/web/src/features/chat/conversation-view.tsx`

- [ ] **步骤 1：写失败测试，验证短时间内连续消息更新只在节流窗口结束时展示最新值。**

```tsx
act(() => result.current.update(secondMessages));
act(() => vi.advanceTimersByTime(79));
expect(result.current.messages).toBe(firstMessages);
act(() => vi.advanceTimersByTime(1));
expect(result.current.messages).toBe(secondMessages);
```

- [ ] **步骤 2：实现 `useThrottledMessages`。**

使用前沿立即更新与 80ms 尾随更新；每个窗口只渲染一次最新消息，组件卸载时清理定时器。该 Hook 只控制展示用消息，不影响 `useChat` 的取消、错误和流协议状态。

- [ ] **步骤 3：接入展示消息并节流自动滚动。**

`ChatSession` 将 `useChat` 返回的消息传给 `useThrottledMessages(messages, 80)`，`ConversationView` 只渲染节流后的结果。滚动容器仅在用户仍停留底部附近时、且展示消息实际更新时滚到底部。

- [ ] **步骤 4：运行测试与类型检查。**

Run: `pnpm.cmd --filter @rag/web test -- use-throttled-messages.spec.tsx`

Expected: 节流窗口和卸载清理测试通过。

Run: `pnpm.cmd --filter @rag/web typecheck`

Expected: 退出码为 0。
