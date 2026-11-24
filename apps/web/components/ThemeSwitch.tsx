'use client';

import { useCallback, useEffect, useState } from 'react';

type Pref = 'system' | 'light' | 'dark' | 'sepia';

const OPTIONS: Array<{ value: Pref; label: string }> = [
  { value: 'system', label: '自动' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'sepia', label: '护眼' },
];

const STORAGE_KEY = 'pb-theme';

function resolve(pref: Pref): 'light' | 'dark' | 'sepia' {
  if (pref !== 'system') return pref;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export default function ThemeSwitch() {
  const [pref, setPref] = useState<Pref>('system');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as Pref | null) ?? 'system';
    setPref(stored);
    setMounted(true);
  }, []);

  const apply = useCallback((next: Pref) => {
    setPref(next);
    localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.dataset.theme = resolve(next);
    document.documentElement.dataset.themePref = next;
  }, []);

  // 跟随系统时，系统切换要实时跟
  useEffect(() => {
    if (pref !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      document.documentElement.dataset.theme = mq.matches ? 'dark' : 'light';
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pref]);

  return (
    <div className="theme-switch" role="group" aria-label="主题">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          // 未挂载前不显示选中态，避免 SSR/CSR 不一致
          aria-pressed={mounted ? pref === opt.value : false}
          onClick={() => apply(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
