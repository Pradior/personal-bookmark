'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Collection = { id: string; name: string; parentId: string | null; count: number };

/**
 * 阅读页的标签与集合编辑（手动分类）
 *
 * 交互取舍：
 * - 打标签是**回车即生效**，不做"先创建标签"这一步 —— 用户打 "技术"
 *   就应该直接加上去。服务端按名字 upsert。
 * - 集合用原生 select：条目多时下拉比一堆按钮好用，也不需要额外弹窗。
 */
export default function ItemTaxonomy({
  itemId,
  tags: initialTags,
  collectionId: initialCollection,
  collections,
}: {
  itemId: string;
  tags: string[];
  collectionId: string | null;
  collections: Collection[];
}) {
  const router = useRouter();
  const [tags, setTags] = useState<string[]>(initialTags);
  const [collectionId, setCollectionId] = useState<string | null>(initialCollection);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addTag() {
    const name = draft.trim().replace(/^#+/, '');
    if (!name || busy) return;
    if (tags.includes(name)) {
      setDraft('');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/items/${itemId}/tags`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(body?.error?.message ?? `添加失败（HTTP ${res.status}）`);
        return;
      }
      const body = (await res.json()) as { name: string };
      setTags((prev) => (prev.includes(body.name) ? prev : [...prev, body.name]));
      setDraft('');
      router.refresh();
    } catch {
      setError('网络请求失败');
    } finally {
      setBusy(false);
    }
  }

  async function removeTag(name: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const snapshot = tags;
    setTags((prev) => prev.filter((t) => t !== name)); // 乐观更新
    try {
      const res = await fetch(`/api/v1/items/${itemId}/tags?name=${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        setTags(snapshot);
        setError(`移除失败（HTTP ${res.status}）`);
        return;
      }
      router.refresh();
    } catch {
      setTags(snapshot);
      setError('网络请求失败');
    } finally {
      setBusy(false);
    }
  }

  async function changeCollection(value: string) {
    const next = value === '' ? null : value;
    const prev = collectionId;
    setCollectionId(next); // 乐观更新
    try {
      const res = await fetch(`/api/v1/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ collectionId: next }),
      });
      if (!res.ok) {
        setCollectionId(prev);
        setError(`移动失败（HTTP ${res.status}）`);
        return;
      }
      router.refresh();
    } catch {
      setCollectionId(prev);
      setError('网络请求失败');
    }
  }

  return (
    <div className="taxonomy">
      <div className="taxonomy-row">
        <span className="taxonomy-label">标签</span>
        <div className="tag-list">
          {tags.map((t) => (
            <span className="tag" key={t}>
              {t}
              <button
                type="button"
                onClick={() => void removeTag(t)}
                aria-label={`移除标签 ${t}`}
                disabled={busy}
              >
                ×
              </button>
            </span>
          ))}
          <input
            className="tag-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                void addTag();
              }
              if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
                void removeTag(tags[tags.length - 1] as string);
              }
            }}
            placeholder={tags.length === 0 ? '加标签，回车确认' : '+ 标签'}
            aria-label="添加标签"
          />
        </div>
      </div>

      <div className="taxonomy-row">
        <span className="taxonomy-label">集合</span>
        <select
          className="select"
          value={collectionId ?? ''}
          onChange={(e) => void changeCollection(e.target.value)}
          aria-label="所属集合"
        >
          <option value="">未归类</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <p className="form-error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
