const STATUS_LABELS: Record<string, string> = {
  understanding: '正在理解问题',
  retrieving: '正在检索知识库',
  ranking: '正在筛选证据',
  answering: '正在组织回答',
};

export function AssistantActivity({
  status,
  compact,
}: {
  status: string | undefined;
  compact: boolean;
}) {
  const label = status ? (STATUS_LABELS[status] ?? status) : '正在连接知识服务';

  return (
    <div
      role="status"
      aria-live="polite"
      data-compact={compact ? 'true' : 'false'}
      className={`mb-2 inline-flex items-center gap-2 ${
        compact
          ? 'text-xs text-slate-400'
          : 'rounded-full bg-blue-50 px-3 py-1.5 text-sm text-blue-700'
      }`}
    >
      <span
        className={`size-1.5 shrink-0 rounded-full ${
          compact ? 'bg-slate-400' : 'animate-pulse bg-blue-600'
        }`}
        aria-hidden="true"
      />
      <span>{label}</span>
    </div>
  );
}
