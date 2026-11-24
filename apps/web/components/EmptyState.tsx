import type { ReactNode } from 'react';

type Props = {
  mark?: ReactNode;
  title: string;
  desc: ReactNode;
  hint?: ReactNode;
};

export default function EmptyState({ mark, title, desc, hint }: Props) {
  return (
    <div className="empty">
      {mark ? <div className="empty-mark">{mark}</div> : null}
      <div className="empty-title">{title}</div>
      <div className="empty-desc">{desc}</div>
      {hint ? <div className="empty-hint">{hint}</div> : null}
    </div>
  );
}
