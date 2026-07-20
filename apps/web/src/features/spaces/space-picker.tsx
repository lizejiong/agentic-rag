export type VisibleSpace = {
  id: string;
  name: string;
  description: string | null;
  effectivePermission: 'VIEW' | 'EDIT' | 'MANAGE';
};

export function SpacePicker({
  spaces,
  selectedIds,
  onChange,
  loading,
}: {
  spaces: VisibleSpace[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  loading: boolean;
}) {
  return (
    <section className="space-picker" aria-labelledby="space-picker-title">
      <div>
        <p className="eyebrow">KNOWLEDGE SCOPE</p>
        <h2 id="space-picker-title">知识空间</h2>
      </div>
      {loading ? (
        <p className="space-hint">正在加载授权空间…</p>
      ) : spaces.length === 0 ? (
        <p className="space-hint">当前账号暂无可访问空间</p>
      ) : (
        <div className="space-options">
          {spaces.map((space) => {
            const selected = selectedIds.includes(space.id);
            return (
              <label className={selected ? 'space-option selected' : 'space-option'} key={space.id}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() =>
                    onChange(
                      selected
                        ? selectedIds.filter((id) => id !== space.id)
                        : [...selectedIds, space.id],
                    )
                  }
                />
                <span>
                  <strong>{space.name}</strong>
                  <small>{space.effectivePermission}</small>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </section>
  );
}
