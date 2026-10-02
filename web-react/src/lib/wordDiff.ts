// Word-level diff for the review list: which words a suggestion takes out and
// which it puts in. A plain LCS over word-and-space tokens — paragraphs are
// short, and a dependency for this would be heavier than the function.

export interface DiffPart { text: string; op: 'same' | 'add' | 'del' }

const tokenize = (s: string) => s.split(/(\s+)/).filter(Boolean);

export function wordDiff(before: string, after: string): DiffPart[] {
  const a = tokenize(before);
  const b = tokenize(after);
  // Past this, a table of a.length × b.length is more work than it is worth:
  // show the whole thing as replaced.
  if (a.length * b.length > 250_000) {
    return [...(before ? [{ text: before, op: 'del' as const }] : []), ...(after ? [{ text: after, op: 'add' as const }] : [])];
  }
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffPart[] = [];
  const push = (text: string, op: DiffPart['op']) => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += text;
    else out.push({ text, op });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { push(a[i], 'same'); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) push(a[i++], 'del');
    else push(b[j++], 'add');
  }
  while (i < a.length) push(a[i++], 'del');
  while (j < b.length) push(b[j++], 'add');
  return out;
}
