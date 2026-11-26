'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Lightbox = {
  displaySrc: string;
  sourceSrc?: string;
  width?: number;
  height?: number;
};

type Props = {
  html: string;
  /** 正文基准字号（px） */
  fontSize?: number;
  /** 行高倍率 */
  lineHeight?: number;
};

/**
 * 阅读页正文渲染（SPEC §8.1 / §8.2）
 *
 * - iframe srcdoc：彻底隔离原站样式，避免公众号的 CSS 污染我们的界面
 * - sandbox="allow-same-origin"：不给 allow-scripts，所以正文里的脚本无法执行；
 *   但同源能让父页面给图片绑点击事件、并让图片请求带上登录 cookie
 * - 点图片 → 全屏 lightbox → 下侧「预览原图」按需回源（ADR-013）
 *
 * 字号/行高通过**直接改 iframe 文档的 CSS 变量**来生效，而不是重建 srcDoc ——
 * 重建会让 iframe 重新加载，阅读位置和图片都得重来。
 */
export default function ReaderFrame({ html, fontSize = 18, lineHeight = 1.85 }: Props) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [box, setBox] = useState<Lightbox | null>(null);
  const [sourceShown, setSourceShown] = useState(false);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);

  // 字号/行高变化时只改样式，不重载内容
  useEffect(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc?.documentElement) return;
    doc.documentElement.style.setProperty('--pb-font-size', `${fontSize}px`);
    doc.documentElement.style.setProperty('--pb-line-height', String(lineHeight));
  }, [fontSize, lineHeight]);

  const onFrameLoad = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;

    // 恢复字号/行高（srcDoc 首次加载后要再设一次）
    doc.documentElement?.style.setProperty('--pb-font-size', `${fontSize}px`);
    doc.documentElement?.style.setProperty('--pb-line-height', String(lineHeight));

    // iframe 里没有脚本，所以高度由父页面算：内容多高、框就多高，
    // 避免出现"页面里再套一层滚动条"
    const resize = () => {
      const frame = frameRef.current;
      if (!frame) return;
      const h = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight);
      if (h > 0) frame.style.height = `${h + 24}px`;
    };
    resize();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(resize);
      if (doc.body) ro.observe(doc.body);
    }

    doc.querySelectorAll('img').forEach((img) => {
      img.addEventListener('load', resize);
      img.style.cursor = 'zoom-in';
      if (img.dataset.pbBound === '1') return;
      img.dataset.pbBound = '1';
      img.addEventListener('click', (event) => {
        event.preventDefault();
        const w = Number(img.getAttribute('width')) || undefined;
        const h = Number(img.getAttribute('height')) || undefined;
        setBox({
          displaySrc: img.getAttribute('src') ?? '',
          sourceSrc: img.getAttribute('data-source') ?? undefined,
          width: w,
          height: h,
        });
        setSourceShown(false);
        setSourceError(null);
        setSourceLoading(false);
      });
    });
  }, [fontSize, lineHeight]);

  const close = useCallback(() => {
    setBox(null);
    setSourceShown(false);
    setSourceError(null);
  }, []);

  useEffect(() => {
    if (!box) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [box, close]);

  function previewSource() {
    if (!box?.sourceSrc) return;
    setSourceLoading(true);
    setSourceError(null);
    setSourceShown(true);
  }

  return (
    <>
      <iframe
        ref={frameRef}
        className="reader-frame"
        sandbox="allow-same-origin"
        srcDoc={buildDoc(html)}
        onLoad={onFrameLoad}
        title="正文"
      />

      {box ? (
        <div className="lightbox" role="dialog" aria-modal="true" onClick={close}>
          <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="lightbox-img"
              src={sourceShown && box.sourceSrc ? box.sourceSrc : box.displaySrc}
              alt=""
              onLoad={() => setSourceLoading(false)}
              onError={() => {
                setSourceLoading(false);
                if (sourceShown) setSourceError('原图已不可获取（原文可能已删除）');
              }}
            />

            <div className="lightbox-bar">
              {box.sourceSrc ? (
                <button
                  className="btn"
                  type="button"
                  onClick={previewSource}
                  disabled={sourceLoading || (sourceShown && !sourceError)}
                >
                  {sourceLoading ? '正在获取原图…' : sourceShown && !sourceError ? '已是原图' : '预览原图'}
                </button>
              ) : (
                <span className="subtle" style={{ fontSize: 12 }}>
                  这张图没有可回源的原始地址
                </span>
              )}
              <button className="btn btn-ghost" type="button" onClick={close}>
                关闭
              </button>
            </div>

            {sourceError ? (
              <div className="lightbox-error" role="status">
                {sourceError}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

/** 正文外壳：只放排版相关的 CSS，不含任何脚本 */
function buildDoc(html: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
    font-size: var(--pb-font-size, 18px);
    line-height: var(--pb-line-height, 1.85);
    color: #1c1b19;
    background: transparent;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  p { margin: 0 0 1.1em; }
  h1,h2,h3,h4 { line-height: 1.4; margin: 1.6em 0 0.6em; font-weight: 600; }
  h1 { font-size: 1.4em; } h2 { font-size: 1.25em; } h3 { font-size: 1.1em; }
  a { color: #0f766e; }
  img { max-width: 100%; height: auto; display: block; margin: 1em auto; border-radius: 8px; }
  blockquote { margin: 1.2em 0; padding: 0.4em 1em; border-left: 3px solid #d6d1c7; color: #55524c; }
  pre, code { font-family: ui-monospace, Menlo, monospace; font-size: 0.88em; }
  pre { overflow-x: auto; padding: 12px; background: #f4f2ee; border-radius: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.92em; }
  th, td { border: 1px solid #e6e2da; padding: 6px 8px; }
  hr { border: 0; border-top: 1px solid #e6e2da; margin: 2em 0; }
  section, span { max-width: 100%; }
  @media (prefers-color-scheme: dark) {
    body { color: #edeae4; }
    blockquote { border-left-color: #3a3733; color: #a29e96; }
    pre { background: #24231f; }
    th, td { border-color: #3a3733; }
    hr { border-top-color: #2a2825; }
    a { color: #2dd4bf; }
  }
</style></head><body>${html}</body></html>`;
}
