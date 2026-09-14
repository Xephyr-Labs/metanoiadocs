import { useMemo } from 'react';
import { parseBlocks, type Span } from '../../lib/markdown';

/** Renders the small markdown subset a chat reply actually uses. */
function Inline({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((s, i) => {
        if (s.kind === 'bold') return <strong key={i} className="font-semibold">{s.text}</strong>;
        if (s.kind === 'italic') return <em key={i}>{s.text}</em>;
        if (s.kind === 'code')
          return (
            <code key={i} className="rounded bg-surface px-1 py-px font-mono text-2xs text-ink">
              {s.text}
            </code>
          );
        if (s.kind === 'link')
          return (
            <a
              key={i}
              href={s.href}
              target="_blank"
              rel="noreferrer"
              className="text-accent-strong underline underline-offset-2"
            >
              {s.text}
            </a>
          );
        return <span key={i}>{s.text}</span>;
      })}
    </>
  );
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <div className={className}>
      {blocks.map((b, i) => {
        const spacing = i > 0 ? 'mt-2' : '';
        if (b.kind === 'heading') {
          const size = b.level === 1 ? 'text-md' : b.level === 2 ? 'text-base' : 'text-sm';
          return (
            <p key={i} className={`${spacing} ${size} font-semibold text-ink`}>
              <Inline spans={b.spans} />
            </p>
          );
        }
        if (b.kind === 'list') {
          const Tag = b.ordered ? 'ol' : 'ul';
          return (
            <Tag
              key={i}
              className={`${spacing} space-y-1 pl-4 ${b.ordered ? 'list-decimal' : 'list-disc'} marker:text-faint`}
            >
              {b.items.map((item, j) => (
                <li key={j} className="leading-relaxed">
                  <Inline spans={item} />
                </li>
              ))}
            </Tag>
          );
        }
        if (b.kind === 'code') {
          return (
            <pre
              key={i}
              className={`${spacing} overflow-x-auto rounded-md bg-surface p-2.5 font-mono text-2xs leading-relaxed text-ink`}
            >
              {b.text}
            </pre>
          );
        }
        if (b.kind === 'quote') {
          return (
            <p key={i} className={`${spacing} border-l-2 border-line pl-2.5 text-muted`}>
              <Inline spans={b.spans} />
            </p>
          );
        }
        if (b.kind === 'rule') return <hr key={i} className={`${spacing} border-line`} />;
        return (
          <p key={i} className={`${spacing} whitespace-pre-wrap leading-relaxed`}>
            <Inline spans={b.spans} />
          </p>
        );
      })}
    </div>
  );
}
