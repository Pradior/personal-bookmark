'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconX } from './icons';

const MAX_IMAGES = 9;
const MAX_BYTES = 15 * 1024 * 1024;

type Picked = { file: File; url: string };

/**
 * 速记编辑器：文字 + 图片（可选），粘贴/拖拽/选择三种入口。
 *
 * 刻意不做富文本：速记的价值是"快"，加粗斜体那一套会让人开始排版，
 * 反而慢了。需要排版的内容应该走文章，而不是这里。
 */
export default function NoteComposer({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: (itemId: string) => void;
}) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 关闭时清空，避免下次打开看到上次的残留
  useEffect(() => {
    if (!open) return;
    setText('');
    setPicked([]);
    setError(null);
    const t = setTimeout(() => areaRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  // 释放 objectURL，防内存泄漏
  useEffect(() => {
    return () => {
      for (const p of picked) URL.revokeObjectURL(p.url);
    };
  }, [picked]);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const incoming = Array.from(files).filter((f) => f.type.startsWith('image/'));
      if (incoming.length === 0) return;

      setPicked((prev) => {
        const room = MAX_IMAGES - prev.length;
        if (room <= 0) {
          setError(`最多 ${MAX_IMAGES} 张图`);
          return prev;
        }
        const accepted: Picked[] = [];
        for (const f of incoming.slice(0, room)) {
          if (f.size > MAX_BYTES) {
            setError(`「${f.name || '图片'}」超过 15MB，已跳过`);
            continue;
          }
          accepted.push({ file: f, url: URL.createObjectURL(f) });
        }
        return [...prev, ...accepted];
      });
    },
    [],
  );

  const removeAt = (index: number) => {
    setPicked((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((_, i) => i !== index);
    });
  };

  async function save() {
    if (busy) return;
    if (text.trim().length === 0 && picked.length === 0) {
      setError('写点文字或贴张图');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('text', text);
      for (const p of picked) form.append('images', p.file, p.file.name || 'image');

      const res = await fetch('/api/v1/notes', { method: 'POST', body: form });
      const body = (await res.json().catch(() => null)) as
        | { itemId?: string; failures?: { name: string; reason: string }[]; error?: { message?: string } }
        | null;

      if (!res.ok) {
        setError(body?.error?.message ?? `保存失败（HTTP ${res.status}）`);
        return;
      }

      if (body?.failures?.length) {
        // 有图没进去：说明白哪张为什么失败
        setError(
          `${body.failures.length} 张图没处理成功：` +
            body.failures.map((f) => `${f.name}（${f.reason}）`).join('，'),
        );
      }

      onClose();
      router.refresh();
      if (body?.itemId) onSaved?.(body.itemId);
    } catch {
      setError('网络请求失败');
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="note-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="写速记"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="note-panel">
        <div className="note-head">
          <strong>写速记</strong>
          <span className="subtle" style={{ fontSize: 12 }}>
            文字和图片都会存进收件箱
          </span>
          <button className="btn btn-ghost" type="button" onClick={onClose} aria-label="关闭">
            <IconX />
          </button>
        </div>

        <textarea
          ref={areaRef}
          className="note-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData?.files ?? []);
            if (files.length > 0) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            addFiles(e.dataTransfer.files);
          }}
          placeholder="想到什么就写下来…（可直接粘贴截图）"
          rows={8}
        />

        {picked.length > 0 ? (
          <div className="note-thumbs">
            {picked.map((p, i) => (
              <div className="note-thumb" key={p.url}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="" />
                <button type="button" onClick={() => removeAt(i)} aria-label="移除这张图">
                  <IconX />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="note-foot">
          <button className="btn" type="button" onClick={() => fileRef.current?.click()}>
            添加图片
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <span className="subtle" style={{ fontSize: 12, marginLeft: 'auto' }}>
            {picked.length > 0 ? `${picked.length}/${MAX_IMAGES} 张` : '⌘V 可粘贴截图'}
          </span>
          <button className="btn btn-primary" type="button" onClick={() => void save()} disabled={busy}>
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
