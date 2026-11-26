'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ReaderFrame from './ReaderFrame';

const FONT_STEPS = [16, 18, 20, 22];
const LINE_STEPS = [1.6, 1.85, 2.05];
const STORAGE_KEY = 'pb.reader.prefs';

type Prefs = { font: number; line: number };

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Prefs>;
      const font = Number(parsed.font);
      const line = Number(parsed.line);
      return {
        font: FONT_STEPS.includes(font) ? font : 18,
        line: LINE_STEPS.includes(line) ? line : 1.85,
      };
    }
  } catch {
    // 隐私模式下 localStorage 会抛错，忽略即可
  }
  return { font: 18, line: 1.85 };
}

type Props = {
  itemId: string;
  html: string;
  prevId: string | null;
  nextId: string | null;
  prevTitle: string | null;
  nextTitle: string | null;
  /** 原文链接（速记为 null） */
  sourceUrl: string | null;
};

/**
 * 阅读页的交互层：排版偏好 + 阅读进度 + 键盘。
 *
 * 键盘（不用改任何服务端逻辑）：
 *   J / K      下一篇 / 上一篇
 *   + / -      字号增减
 *   E          归档并返回列表
 *   O          新窗口打开原文
 *
 * 进度条按父页面滚动算 —— 正文 iframe 被撑成内容全高，滚动的是外层窗口。
 */
export default function ReaderBody({
  itemId,
  html,
  prevId,
  nextId,
  prevTitle,
  nextTitle,
  sourceUrl,
}: Props) {
  const router = useRouter();
  const [prefs, setPrefs] = useState<Prefs>({ font: 18, line: 1.85 });
  const [progress, setProgress] = useState(0);
  const [archiving, setArchiving] = useState(false);
  const ready = useRef(false);

  useEffect(() => {
    setPrefs(loadPrefs());
    ready.current = true;
  }, []);

  useEffect(() => {
    if (!ready.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      /* 忽略 */
    }
  }, [prefs]);

  // 阅读进度
  useEffect(() => {
    const compute = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollable <= 0) {
        setProgress(0);
        return;
      }
      setProgress(Math.min(1, Math.max(0, window.scrollY / scrollable)));
    };
    compute();
    window.addEventListener('scroll', compute, { passive: true });
    window.addEventListener('resize', compute);
    return () => {
      window.removeEventListener('scroll', compute);
      window.removeEventListener('resize', compute);
    };
  }, []);

  const archive = useCallback(async () => {
    if (archiving) return;
    setArchiving(true);
    try {
      const res = await fetch(`/api/v1/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      });
      if (res.ok) router.push('/inbox');
    } finally {
      setArchiving(false);
    }
  }, [archiving, itemId, router]);

  const bumpFont = useCallback((delta: number) => {
    setPrefs((p) => {
      const index = FONT_STEPS.indexOf(p.font);
      const next = Math.min(FONT_STEPS.length - 1, Math.max(0, index + delta));
      return { ...p, font: FONT_STEPS[next] ?? p.font };
    });
  }, []);

  // 键盘
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 输入框/可编辑区域里不劫持
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key.toLowerCase();
      if (key === 'j' && nextId) {
        e.preventDefault();
        router.push(`/item/${nextId}`);
      } else if (key === 'k' && prevId) {
        e.preventDefault();
        router.push(`/item/${prevId}`);
      } else if (key === '+' || key === '=') {
        e.preventDefault();
        bumpFont(1);
      } else if (key === '-' || key === '_') {
        e.preventDefault();
        bumpFont(-1);
      } else if (key === 'e') {
        e.preventDefault();
        void archive();
      } else if (key === 'o' && sourceUrl) {
        e.preventDefault();
        window.open(sourceUrl, '_blank', 'noopener,noreferrer');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [archive, bumpFont, nextId, prevId, router, sourceUrl]);

  const lineIndex = LINE_STEPS.indexOf(prefs.line);

  return (
    <>
      <div className="read-progress" aria-hidden>
        <div className="read-progress-bar" style={{ transform: `scaleX(${progress})` }} />
      </div>

      <div className="reader-body">
        <ReaderFrame html={html} fontSize={prefs.font} lineHeight={prefs.line} />
      </div>

      <div className="reader-fab" role="group" aria-label="阅读设置">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => bumpFont(-1)}
          aria-label="减小字号"
          title="减小字号（-）"
        >
          A−
        </button>
        <span className="reader-fab-value">{prefs.font}</span>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => bumpFont(1)}
          aria-label="增大字号"
          title="增大字号（+）"
        >
          A+
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() =>
            setPrefs((p) => ({
              ...p,
              line: LINE_STEPS[(lineIndex + 1) % LINE_STEPS.length] ?? p.line,
            }))
          }
          title="切换行高"
        >
          行高 {(prefs.line).toFixed(2)}
        </button>
        {prevId ? (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => router.push(`/item/${prevId}`)}
            title={prevTitle ?? '上一篇（K）'}
          >
            ↑ K
          </button>
        ) : null}
        {nextId ? (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => router.push(`/item/${nextId}`)}
            title={nextTitle ?? '下一篇（J）'}
          >
            ↓ J
          </button>
        ) : null}
      </div>
    </>
  );
}
