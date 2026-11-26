'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import ItemActions from './ItemActions';
import ReaderFrame from './ReaderFrame';
import { IconLayers } from './icons';
import { useWorkspace } from './WorkspaceContext';

type Preview = {
  id: string;
  title: string | null;
  author: string | null;
  siteName: string | null;
  url: string | null;
  status: 'inbox' | 'reading' | 'archived' | 'trashed';
  collectionId: string | null;
  wordCount: number;
  contentHtml: string | null;
  fetchState: string;
  fetchError: string | null;
};

const STORAGE_KEY = 'pb.reader.prefs';

function loadPrefs(): { font: number; line: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { font?: number; line?: number };
      return {
        font: typeof parsed.font === 'number' ? parsed.font : 18,
        line: typeof parsed.line === 'number' ? parsed.line : 1.85,
      };
    }
  } catch {
    /* 隐私模式忽略 */
  }
  return { font: 18, line: 1.85 };
}

/**
 * 右栏阅读器
 *
 * 单击列表卡片 → 在这里预览；双击才进独立阅读页（大屏时）。
 * 这是参考 Cubox / feed 阅读器的习惯：浏览列表时不该每点一下就整页跳走。
 *
 * 预览只拉这一条的正文（/api/v1/items/:id），不预取列表，
 * 所以首屏不变慢。请求带 AbortController，快速连点不会出现
 * "后发的请求先回来"导致的错位。
 */
export default function DetailPane() {
  const workspace = useWorkspace();
  const selectedId = workspace?.selectedId ?? null;

  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState({ font: 18, line: 1.85 });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setPrefs(loadPrefs());
  }, []);

  const load = useCallback(async (id: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/items/${id}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!res.ok) {
        setError(`加载失败（HTTP ${res.status}）`);
        return;
      }
      const body = (await res.json()) as Preview;
      setPreview(body);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return; // 被下一次点击取代，正常
      setError('网络请求失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setPreview(null);
      return;
    }
    void load(selectedId);
  }, [load, selectedId]);

  if (!selectedId) {
    return (
      <div className="detail-empty">
        <IconLayers width={22} height={22} />
        <span>单击左侧条目在这里预览</span>
        <span className="subtle" style={{ fontSize: 12 }}>
          双击进入独立阅读页
        </span>
      </div>
    );
  }

  const current = preview?.id === selectedId ? preview : null;

  return (
    <div className="pane-reader">
      <div className="pane-reader-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="pane-reader-title">
            {current?.title ?? (loading ? '加载中…' : '（无标题）')}
          </div>
          {current ? (
            <div className="pane-reader-meta">
              {[current.author, current.siteName, current.wordCount ? `${current.wordCount} 字` : null]
                .filter(Boolean)
                .join(' · ')}
            </div>
          ) : null}
        </div>

        {current ? (
          <>
            <Link
              href={`/item/${current.id}`}
              className="btn btn-ghost"
              title="在独立页面打开（双击卡片也一样）"
            >
              展开 ↗
            </Link>
            {current.url ? (
              <a
                className="btn btn-ghost"
                href={current.url}
                target="_blank"
                rel="noopener noreferrer"
                title="在新窗口打开原文"
              >
                原文
              </a>
            ) : null}
            <ItemActions
              variant="reader"
              item={{
                id: current.id,
                status: current.status,
                hasUrl: Boolean(current.url),
                collectionId: current.collectionId,
              }}
            />
          </>
        ) : null}
      </div>

      <div className="pane-reader-body">
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : loading && !current ? (
          <p className="subtle" style={{ fontSize: 13 }}>
            正在加载…
          </p>
        ) : current?.fetchState === 'failed' ? (
          <div className="banner is-warn" style={{ margin: 0 }}>
            <div>
              <strong>只保存了链接。</strong>
              {current.fetchError ? ` ${current.fetchError}` : ' 正文没能抓下来。'}
              <br />
              <Link href={`/item/${current.id}`}>去独立页面重试抓取 →</Link>
            </div>
          </div>
        ) : current?.contentHtml ? (
          <ReaderFrame html={current.contentHtml} fontSize={prefs.font} lineHeight={prefs.line} />
        ) : (
          <p className="subtle">还没有正文内容。</p>
        )}
      </div>
    </div>
  );
}
