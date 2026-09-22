/* Hallmark · component: the "@" page picker · genre: modern-minimal
 * theme: project tokens, inherited through the popover's shadow DOM
 * states: default · typing · active row (keyboard) · no matches · empty query
 */
import { linkPeople, liveLinkMenu, rankPages, type LinkTarget } from './pageLinks';

/**
 * Give the "@" menu a search box, and our own face.
 *
 * BlockSuite's linked-doc popover is a list with no input: the thing you type
 * into is the document itself, three lines away from the list it filters. That
 * reads as a menu that happens to change, not as a search — people did not know
 * they could type at all, and asked for the box they were already using. It
 * also arrives as a BlockSuite surface: tight rows, its own radius and type,
 * visibly not this app.
 *
 * So the shell stays and the contents are ours. The widget still does what it
 * is good at — spotting the trigger, placing the popover, closing it, cleaning
 * the typed "@" away — while the panel below draws the search field, the
 * ranked results and the keyboard handling. The query lives in our input
 * rather than in the page, which is why the document is left alone while
 * somebody hunts for a page.
 *
 * If this never attaches, the widget's own list is still there underneath: the
 * CSS that hides it is injected by the same code that adds the panel.
 */
export function attachLinkedDocMenu(
  editor: Element,
  { pages, currentId }: { pages: () => LinkTarget[]; currentId: string },
): () => void {
  const enhance = async (pop: PopoverLike) => {
    if (pop.dataset?.mnPanel) return;
    await pop.updateComplete;
    // A task peek open over a page means two editors, each with one of these
    // attached, both watching the same body for the same popover. The one it
    // belongs to is the one whose host it points at — anyone else leaves it
    // alone, or the panel offers the wrong page index and hides the wrong
    // current page.
    const host = pop.context?.std?.host;
    if (host && !editor.contains(host)) return;
    const shadow = pop.shadowRoot;
    const shell = shadow?.querySelector<HTMLElement>('.linked-doc-popover');
    if (!shadow || !shell) return;
    pop.dataset.mnPanel = 'on';

    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    shadow.append(style);

    const panel = document.createElement('div');
    panel.className = 'mn-link-panel';
    const field = document.createElement('div');
    field.className = 'mn-link-field';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Search pages and people';
    input.setAttribute('aria-label', 'Search pages and people');
    // Whatever was typed before this panel existed is already in the page, and
    // the widget has it as its query — start from there, or a fast "@design"
    // loses its "d" to the frame the popover took to appear.
    input.value = liveLinkMenu()?.query ?? '';
    field.append(input);
    const list = document.createElement('div');
    list.className = 'mn-link-list';
    panel.append(field, list);
    shell.append(panel);
    // Focused now, not next frame: every keystroke in between goes into the
    // page instead. preventScroll because the popover is mid-placement and the
    // browser would otherwise scroll to where it currently stands.
    input.focus({ preventScroll: true });

    let rows: Row[] = [];
    let found = false;
    let active = 0;

    const note = (text: string) => {
      const p = document.createElement('p');
      p.className = 'mn-link-empty';
      p.textContent = text;
      return p;
    };

    const run = (row: Row) => {
      const menu = liveLinkMenu();
      if (!menu) return;
      if (row.kind === 'page') menu.link(row.id);
      else if (row.kind === 'person') menu.mention(row.id);
      else void menu.create(input.value);
    };

    const paint = () => {
      list.replaceChildren();
      let group = '';
      rows.forEach((row, i) => {
        if (row.group !== group) {
          group = row.group;
          const title = document.createElement('p');
          title.className = 'mn-link-group';
          title.textContent = group;
          list.append(title);
        }
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'mn-link-row';
        el.dataset.active = String(i === active);
        const icon = document.createElement('span');
        icon.className = 'mn-link-icon';
        icon.textContent = row.icon;
        const label = document.createElement('span');
        label.className = 'mn-link-label';
        label.textContent = row.label;
        el.append(icon, label);
        if (row.hint) {
          const hint = document.createElement('span');
          hint.className = 'mn-link-hint';
          hint.textContent = row.hint;
          el.append(hint);
        }
        // pointerdown, not click: the input is about to lose focus, and a click
        // that lands after the popover closed never arrives (see linkSearch).
        el.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          run(row);
        });
        list.append(el);
      });
      if (!found) {
        // Above the "create" row, which is always there: without this, a query
        // that matches nothing looks the same as one still being typed.
        list.insertBefore(note('No page or person by that name.'), list.firstChild);
      }
      list.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
    };

    const search = () => {
      const query = input.value.trim();
      const people = linkPeople()
        .filter((u) => !query || match(u.name, query) || match(u.username ?? '', query))
        .slice(0, MAX_PEOPLE)
        .map((u): Row => ({
          kind: 'person',
          id: u.username ?? '',
          group: 'People',
          icon: '👤',
          label: u.name || (u.username ?? ''),
          hint: u.username ? `@${u.username}` : undefined,
        }));
      const docs = rankPages(pages().filter((p) => p.id !== currentId), query)
        .slice(0, MAX_PAGES)
        .map((p): Row => ({
          kind: 'page',
          id: p.id,
          group: 'Pages',
          icon: p.icon || '📄',
          label: p.title || 'Untitled',
        }));
      // Whoever the query names outright comes first. "elena" put three pages
      // above Elena because a subsequence match is still a match — true, and
      // not what the person typing a colleague's name is asking for.
      const named = query.length > 1 && people.some((u) =>
        u.label.toLowerCase().startsWith(query.toLowerCase()) ||
        (u.hint ?? '').toLowerCase().startsWith(`@${query.toLowerCase()}`));
      found = docs.length > 0 || people.length > 0;
      rows = [...(named ? [...people, ...docs] : [...docs, ...people]), {
        kind: 'create',
        id: 'create',
        group: 'New',
        icon: '✨',
        label: query ? `Create “${query}” and link it` : 'Create a page and link it',
      }];
      active = 0;
      paint();
    };

    input.addEventListener('input', search);
    // Every key stops here. The panel lives in the popover's shadow DOM, so a
    // keystroke that escapes it reaches the window retargeted to the popover
    // element — not to an input — and the app's own shortcuts take it for a
    // press on the page: typing "relaunch" opened the new-task dialog on the
    // "n". Nothing outside this panel needs to hear it.
    input.addEventListener('keyup', (e) => e.stopPropagation());
    input.addEventListener('keypress', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.isComposing) return;
      if (e.key === 'ArrowDown') active = (active + 1) % rows.length;
      else if (e.key === 'ArrowUp') active = (active - 1 + rows.length) % rows.length;
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); run(rows[active]); return; }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); liveLinkMenu()?.abort(); return; }
      else return;
      e.preventDefault();
      e.stopPropagation();
      paint();
    });

    search();

    // The widget re-renders its own list when its query changes, which takes
    // the panel with it. Cheap to notice, cheap to put back — until the
    // popover itself is gone, and then this has nothing left to watch.
    const keep = new MutationObserver(() => {
      if (!pop.isConnected) keep.disconnect();
      else if (!panel.isConnected) shell.append(panel);
    });
    keep.observe(shell, { childList: true });
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLElement && node.tagName.endsWith('LINKED-DOC-POPOVER')) {
          void enhance(node as PopoverLike);
        }
      }
    }
  });
  // The body, not the editor: the widget portals the popover out of it.
  observer.observe(editor.ownerDocument.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

const MAX_PAGES = 8;
const MAX_PEOPLE = 4;

interface Row {
  kind: 'page' | 'person' | 'create';
  /** Page id, username, or 'create'. */
  id: string;
  group: string;
  icon: string;
  label: string;
  hint?: string;
}

interface PopoverLike extends HTMLElement {
  updateComplete?: Promise<unknown>;
  /** The widget's own handle on the editor it opened over. */
  context?: { std?: { host?: Element } };
}

/** Plain substring, for names. Pages get the ranked match instead. */
const match = (value: string, query: string) =>
  value.toLowerCase().includes(query.toLowerCase());

const PANEL_CSS = `
  .linked-doc-popover > *:not(.mn-link-panel) { display: none !important; }
  .linked-doc-popover {
    width: 320px;
    padding: 0 !important;
    border-radius: 12px;
    background: var(--canvas);
    box-shadow: 0 0 0 1px var(--line), 0 2px 4px rgba(15, 15, 15, 0.04), 0 8px 24px rgba(15, 15, 15, 0.1);
    font-family: inherit;
    color: var(--ink);
    overflow: hidden;
  }
  .mn-link-panel { display: flex; flex-direction: column; min-height: 0; }
  .mn-link-field { padding: 8px 10px; border-bottom: 1px solid var(--line); }
  .mn-link-field input {
    width: 100%;
    border: 0;
    background: transparent;
    font: inherit;
    font-size: 13px;
    color: var(--ink);
    outline: none;
  }
  .mn-link-field input::placeholder { color: var(--faint); }
  .mn-link-list { padding: 4px; overflow-y: auto; max-height: 292px; }
  .mn-link-group {
    margin: 6px 8px 2px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--faint);
  }
  .mn-link-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    font: inherit;
    font-size: 13px;
    color: var(--ink);
    text-align: left;
    cursor: pointer;
  }
  .mn-link-row:hover, .mn-link-row[data-active='true'] { background: var(--hover); }
  .mn-link-icon { flex: none; font-size: 15px; line-height: 20px; }
  .mn-link-label { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mn-link-hint { flex: none; font-size: 11px; color: var(--faint); }
  .mn-link-empty { padding: 10px 8px; font-size: 12px; color: var(--faint); }
`;
