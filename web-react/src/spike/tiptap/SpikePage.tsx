// SPIKE: one page opened in Tiptap instead of BlockSuite, at /spike/tiptap/:id.
//
// Read-only with respect to the server: it loads the page's latest saved
// version, converts it in the browser, and never writes back. Edits live in
// this tab only. The point is to feel typing and the keyboard bar on a phone.
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import {
  Bold, CheckSquare, Code, Heading1, Heading2, Italic, Keyboard, Link2, List, ListOrdered,
  Quote, Redo2, Strikethrough, Underline, Undo2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { docsApi } from '../../lib/docsApi';
import { spikeExtensions } from './extensions';
import { convertDoc } from './fromBlocksuite.js';
import './spike.css';

type Loaded = { title: string; doc: object; lost: Record<string, number> };

async function load(id: string): Promise<Loaded> {
  const versions = await docsApi.versions(id);
  if (!versions.length) throw new Error('This page has no saved version yet.');
  const y = new Y.Doc();
  Y.applyUpdate(y, await docsApi.versionState(id, versions[0].id));
  return convertDoc(y);
}

export default function SpikePage({ id }: { id: string }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { load(id).then(setData, (e) => setError(String(e?.message ?? e))); }, [id]);
  if (error) return <p className="p-6 text-ink">{error}</p>;
  if (!data) return <p className="p-6 text-muted">Loading…</p>;
  return <SpikeEditor data={data} />;
}

function SpikeEditor({ data }: { data: Loaded }) {
  const editor = useEditor({ extensions: spikeExtensions(), content: data.doc, immediatelyRender: true });
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const on = () => setFocused(true);
    const off = () => setFocused(false);
    editor.on('focus', on);
    editor.on('blur', off);
    return () => { editor.off('focus', on); editor.off('blur', off); };
  }, [editor]);
  const lost = Object.entries(data.lost);
  return (
    <div className="mn-spike min-h-dvh bg-canvas text-ink">
      <div className="mx-auto max-w-[720px] px-4 pb-40 pt-6">
        <p className="mb-2 text-[12px] text-muted">
          Tiptap spike · edits stay in this tab{lost.length ? ` · not converted: ${lost.map(([k, v]) => `${k} ×${v}`).join(', ')}` : ''}
        </p>
        <h1 className="mb-4 text-[32px] font-bold leading-tight">{data.title || 'Untitled'}</h1>
        <EditorContent editor={editor} />
      </div>
      {focused && <KeyboardBar editor={editor} />}
    </div>
  );
}

/** Pinned to the top edge of the keyboard: the bottom of the visual viewport,
 *  which both iOS and Android report whether or not the layout resized. */
function useKeyboardTop(bar: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const vv = window.visualViewport;
    let frame = 0;
    const place = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = bar.current;
        if (!el) return;
        const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
        el.style.transform = `translateY(${bottom - el.offsetHeight}px)`;
      });
    };
    place();
    vv?.addEventListener('resize', place);
    vv?.addEventListener('scroll', place);
    return () => {
      cancelAnimationFrame(frame);
      vv?.removeEventListener('resize', place);
      vv?.removeEventListener('scroll', place);
    };
  }, [bar]);
}

function KeyboardBar({ editor }: { editor: Editor }) {
  const bar = useRef<HTMLDivElement>(null);
  useKeyboardTop(bar);
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'), italic: e.isActive('italic'), underline: e.isActive('underline'),
      strike: e.isActive('strike'), code: e.isActive('code'), link: e.isActive('link'),
      h1: e.isActive('heading', { level: 1 }), h2: e.isActive('heading', { level: 2 }),
      ul: e.isActive('bulletList'), ol: e.isActive('orderedList'), todo: e.isActive('taskList'),
      quote: e.isActive('blockquote'), undo: e.can().undo(), redo: e.can().redo(),
    }),
  });
  const c = () => editor.chain().focus();
  const link = () => {
    const href = window.prompt('Link', editor.getAttributes('link').href ?? 'https://');
    if (href === null) return;
    if (href === '') c().unsetLink().run();
    else c().extendMarkRange('link').setLink({ href }).run();
  };
  const items: [string, typeof Bold, boolean, () => void, boolean?][] = [
    ['Bold', Bold, s.bold, () => c().toggleBold().run()],
    ['Italic', Italic, s.italic, () => c().toggleItalic().run()],
    ['Underline', Underline, s.underline, () => c().toggleUnderline().run()],
    ['Strikethrough', Strikethrough, s.strike, () => c().toggleStrike().run()],
    ['Link', Link2, s.link, link],
    ['Heading 1', Heading1, s.h1, () => c().toggleHeading({ level: 1 }).run()],
    ['Heading 2', Heading2, s.h2, () => c().toggleHeading({ level: 2 }).run()],
    ['Bulleted list', List, s.ul, () => c().toggleBulletList().run()],
    ['Numbered list', ListOrdered, s.ol, () => c().toggleOrderedList().run()],
    ['To-do', CheckSquare, s.todo, () => c().toggleTaskList().run()],
    ['Quote', Quote, s.quote, () => c().toggleBlockquote().run()],
    ['Code', Code, s.code, () => c().toggleCode().run()],
    ['Undo', Undo2, false, () => c().undo().run(), !s.undo],
    ['Redo', Redo2, false, () => c().redo().run(), !s.redo],
  ];
  return (
    <div ref={bar} className="mn-spike-bar" role="toolbar" aria-label="Formatting"
      // Keep the editor focused (and the keyboard up) through a tap.
      onPointerDown={(e) => e.preventDefault()}>
      <div className="mn-spike-bar-items">
        {items.map(([label, Icon, active, run, disabled]) => (
          <button key={label} type="button" aria-label={label} aria-pressed={active} disabled={disabled} onClick={run}>
            <Icon size={20} />
          </button>
        ))}
      </div>
      <button type="button" aria-label="Hide keyboard" onClick={() => editor.commands.blur()}>
        <Keyboard size={20} />
      </button>
    </div>
  );
}
