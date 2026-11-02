// Plain text for search + server-side signal extraction, walked off the STORE
// rather than the DOM. `innerText` is lossy here: a todo's checkbox is DOM
// chrome, so `- [ ]` / `- [x]` never appear in it and the backend's fallback
// parser reads every task as an ordinary paragraph. Walking blocks also picks
// up text the editor hasn't rendered. Database cell values are included so they
// stay searchable, which the DOM read gave us for free.
//
// The store is typed loosely at this boundary (mirrors data-source.ts).

// Reads the page with nothing pending accepted: suggested insertions and blocks
// are out, suggested deletions and removals are still in, a retyped block has
// its old type. The same rule as the server's (server/src/inline-suggest.js);
// the two run in different runtimes and share no package, so it is written twice.
const textOf = (t: any): string =>
  typeof t?.toDelta === 'function'
    ? t.toDelta().filter((op: any) => op.attributes?.mnSugg?.kind !== 'ins').map((op: any) => (typeof op.insert === 'string' ? op.insert : '')).join('')
    : t?.toString?.() ?? '';

/** One line per block, in tree order. Todos keep their `- [ ]` / `- [x]` marker. */
export function docPlainText(store: unknown): string {
  const lines: string[] = [];
  const walk = (model: any) => {
    if (!model) return;
    const p = model.props ?? model;
    const sg = p.mnSugg;
    if (sg?.kind === 'add') return;
    const was = sg?.kind === 'type' && sg.from ? sg.from : null;
    const flavour = was?.flavour ?? model.flavour;
    const type = was ? was.type : p.type;
    const text = textOf(model.text ?? p.text);
    if (text) {
      lines.push(flavour === 'affine:list' && type === 'todo'
        ? `- [${p.checked ? 'x' : ' '}] ${text}`
        : text);
    }
    if (model.flavour === 'affine:database') {
      for (const row of Object.values(p.cells ?? {}) as any[]) {
        for (const cell of Object.values(row ?? {}) as any[]) {
          if (cell?.value != null && cell.value !== '') lines.push(String(cell.value));
        }
      }
    }
    for (const child of model.children ?? []) walk(child);
  };
  for (const child of (store as any)?.root?.children ?? []) walk(child);
  return lines.join('\n');
}
