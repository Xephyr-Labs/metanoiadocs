/**
 * Just enough markdown for a chat reply.
 *
 * The copilot answers in markdown, and a panel that prints `**bold**` and
 * `- item` literally reads like a debug log. This is deliberately not a
 * markdown library: it covers what a model actually emits in a two-paragraph
 * answer — headings, lists, code, quotes, links, bold/italic — and nothing
 * else. Parsing is pure so it can be tested without a DOM; rendering lives in
 * components/ui/Markdown.tsx.
 *
 * It also has to survive being called on every token of a stream, so a fence
 * or a bold run that is still being typed must render as ordinary text rather
 * than swallow the rest of the message.
 */

export type Span =
  | { kind: 'text' | 'bold' | 'italic' | 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; spans: Span[] }
  | { kind: 'paragraph' | 'quote'; spans: Span[] }
  | { kind: 'list'; ordered: boolean; items: Span[][] }
  | { kind: 'code'; text: string }
  | { kind: 'rule' };

const INLINE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|__[^_]+__|`[^`]+`|\[[^\]\n]+\]\([^)\s]+\))/;

/** Split one line of markdown into styled spans. Unclosed markers stay text. */
export function parseInline(input: string): Span[] {
  const out: Span[] = [];
  let rest = input;
  for (;;) {
    const m = INLINE.exec(rest);
    if (!m || m.index === undefined) break;
    if (m.index > 0) out.push({ kind: 'text', text: rest.slice(0, m.index) });
    const tok = m[0];
    if (tok.startsWith('**') || tok.startsWith('__')) {
      out.push({ kind: 'bold', text: tok.slice(2, -2) });
    } else if (tok.startsWith('`')) {
      out.push({ kind: 'code', text: tok.slice(1, -1) });
    } else if (tok.startsWith('[')) {
      const cut = tok.indexOf('](');
      out.push({ kind: 'link', text: tok.slice(1, cut), href: tok.slice(cut + 2, -1) });
    } else {
      out.push({ kind: 'italic', text: tok.slice(1, -1) });
    }
    rest = rest.slice(m.index + tok.length);
  }
  if (rest) out.push({ kind: 'text', text: rest });
  return out;
}

const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^(#{1,3})\s+(.*)$/;

/** Split a markdown string into blocks. */
export function parseBlocks(input: string): Block[] {
  const lines = String(input).replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];

  // Newlines are kept, not folded into spaces: a model that answers in three
  // short lines means three lines, and markdown's "join the paragraph" rule
  // turns that into one run-on sentence. The renderer wraps on them.
  const flush = () => {
    if (!para.length) return;
    blocks.push({ kind: 'paragraph', spans: parseInline(para.join('\n')) });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^\s*```/.test(line)) {
      flush();
      const body: string[] = [];
      i++;
      // An unterminated fence is what a half-streamed answer looks like: take
      // the rest of the message as code rather than dropping it.
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      flush();
      blocks.push({ kind: 'rule' });
      continue;
    }

    const h = HEADING.exec(line);
    if (h) {
      flush();
      blocks.push({
        kind: 'heading',
        level: h[1].length as 1 | 2 | 3,
        spans: parseInline(h[2]),
      });
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flush();
      const ordered = !bullet;
      const items: Span[][] = [];
      for (; i < lines.length; i++) {
        const m = ordered ? NUMBERED.exec(lines[i]) : BULLET.exec(lines[i]);
        if (!m) break;
        items.push(parseInline(m[1]));
      }
      i--;
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flush();
      blocks.push({ kind: 'quote', spans: parseInline(line.replace(/^\s*>\s?/, '')) });
      continue;
    }

    para.push(line.trim());
  }
  flush();
  return blocks;
}
