/* Hallmark · component: editorial bar · genre: modern-minimal
 * theme: project tokens (index.css) · states: default · hover · focus · active
 * (pressed) · disabled (no editor / no selection) · loading (n/a) · error (n/a)
 * · success (n/a — formatting is its own feedback)
 */
import * as DM from '@radix-ui/react-dropdown-menu';
import { updateBlockType } from '@blocksuite/affine/blocks/note';
import { getTextStyle, toggleBold, toggleCode, toggleItalic, toggleStrike } from '@blocksuite/affine/inlines/preset';
import {
  Bold, Check, ChevronDown, Code, FileText, Italic, Link2, List, ListOrdered,
  ListTodo, Maximize2, Minimize2, PencilRuler, Strikethrough,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { cn } from '../../lib/cn';
import { IconButton } from '../ui/IconButton';
import { SegmentedControl } from '../ui/SegmentedControl';

/** BlockSuite's std scope, loosely typed at this boundary like the editor glue. */
type Std = any;

/** The block shapes the style menu can switch between. */
const BLOCK_TYPES: {
  id: string; label: string; flavour: string; props: Record<string, unknown>;
}[] = [
  { id: 'text', label: 'Normal text', flavour: 'affine:paragraph', props: { type: 'text' } },
  { id: 'h1', label: 'Heading 1', flavour: 'affine:paragraph', props: { type: 'h1' } },
  { id: 'h2', label: 'Heading 2', flavour: 'affine:paragraph', props: { type: 'h2' } },
  { id: 'h3', label: 'Heading 3', flavour: 'affine:paragraph', props: { type: 'h3' } },
  { id: 'quote', label: 'Quote', flavour: 'affine:paragraph', props: { type: 'quote' } },
  { id: 'code', label: 'Code block', flavour: 'affine:code', props: {} },
];

const LISTS = [
  { id: 'bulleted', label: 'Bulleted list', icon: List },
  { id: 'numbered', label: 'Numbered list', icon: ListOrdered },
  { id: 'todo', label: 'To-do list', icon: ListTodo },
] as const;

const MARKS = [
  { id: 'bold', label: 'Bold', keys: ['⌘', 'B'], icon: Bold, cmd: toggleBold },
  { id: 'italic', label: 'Italic', keys: ['⌘', 'I'], icon: Italic, cmd: toggleItalic },
  { id: 'strike', label: 'Strikethrough', keys: ['⌘', '⇧', 'S'], icon: Strikethrough, cmd: toggleStrike },
  { id: 'code', label: 'Inline code', keys: ['⌘', 'E'], icon: Code, cmd: toggleCode },
] as const;

const Divider = () => <span className="mx-1 h-4 w-px shrink-0 bg-line" aria-hidden />;

interface Props {
  /** The mounted `affine-editor-container`, or null before it loads. */
  editor: Element | null;
  mode: 'page' | 'edgeless';
  onMode: (m: 'page' | 'edgeless') => void;
  fullWidth: boolean;
  onFullWidth: (v: boolean) => void;
}

/**
 * Persistent formatting bar. BlockSuite only shows its own toolbar once text is
 * selected, which leaves every formatting control invisible until you already
 * know it exists — this is the always-there entry point. It drives the same
 * command chain the floating toolbar does, so the two never disagree.
 */
export function EditorBar({ editor, mode, onMode, fullWidth, onFullWidth }: Props) {
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const [blockLabel, setBlockLabel] = useState<string | null>(null);
  const edgeless = mode === 'edgeless';
  // No caret in the document means every command below is a no-op. Say so with
  // the disabled state rather than letting the buttons look live and do nothing.
  const idle = blockLabel === null;

  const std = useCallback((): Std | null => {
    const host = editor?.querySelector('editor-host') as { std?: Std } | null;
    return host?.std ?? null;
  }, [editor]);

  // Mirror the caret's formatting so the pressed states are honest. Reading on
  // selectionchange (rather than polling) keeps this free when nothing moves.
  useEffect(() => {
    if (!editor) return;
    let frame = 0;
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const s = std();
        if (!s) return;
        try {
          const [, ctx] = s.command.chain().pipe(getTextStyle).run();
          setMarks({ ...(ctx?.textStyle ?? {}) });
        } catch { setMarks({}); }
        try {
          const blockId = s.selection?.find?.('text')?.blockId;
          const model = blockId ? s.store?.getBlock?.(blockId)?.model : null;
          if (!model) { setBlockLabel(null); return; }
          const { flavour } = model;
          const type = model.props?.type;
          const hit = flavour === 'affine:code'
            ? 'Code block'
            : flavour === 'affine:list'
              ? LISTS.find((l) => l.id === type)?.label
              : BLOCK_TYPES.find((b) => b.flavour === 'affine:paragraph' && b.props.type === type)?.label;
          setBlockLabel(hit ?? 'Normal text');
        } catch { setBlockLabel(null); }
      });
    };
    document.addEventListener('selectionchange', read);
    read();
    return () => {
      document.removeEventListener('selectionchange', read);
      cancelAnimationFrame(frame);
    };
  }, [editor, std]);

  const runMark = (cmd: unknown) => {
    const s = std();
    if (!s) return;
    try { s.command.chain().pipe(cmd).run(); } catch { /* nothing selected */ }
  };

  const setBlock = (flavour: string, props: Record<string, unknown>) => {
    const s = std();
    if (!s) return;
    try { s.command.chain().pipe(updateBlockType, { flavour, props }).run(); } catch { /* noop */ }
  };

  // Edgeless is a canvas — block formatting has nothing to act on there, so the
  // bar collapses to just the mode switch rather than showing dead controls.
  return (
    <div className="flex h-9 shrink-0 items-center gap-0.5 px-3 md:px-4">
      {!edgeless && (
        <>
          <DM.Root>
            <DM.Trigger asChild>
              <button
                type="button"
                disabled={idle}
                className={cn(
                  'flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-sm transition-colors duration-120',
                  'hover:bg-hover active:bg-selected data-[state=open]:bg-hover',
                  idle ? 'text-faint' : 'text-ink',
                  'disabled:pointer-events-none',
                )}
              >
                <span className="max-w-[9ch] truncate md:max-w-none">{blockLabel ?? 'Normal text'}</span>
                <ChevronDown size={14} className="shrink-0 text-faint" />
              </button>
            </DM.Trigger>
            <DM.Portal>
              <DM.Content align="start" sideOffset={4} className="z-50 w-48 rounded-lg border border-line bg-canvas p-1 shadow-pop animate-scale-in">
                {BLOCK_TYPES.map((b) => (
                  <DM.Item
                    key={b.id}
                    onSelect={() => setBlock(b.flavour, b.props)}
                    className="flex cursor-pointer select-none items-center gap-2 rounded px-2 py-[6px] text-sm text-ink outline-none data-[highlighted]:bg-hover"
                  >
                    <span className="flex-1">{b.label}</span>
                    {blockLabel === b.label && <Check size={14} className="text-accent" />}
                  </DM.Item>
                ))}
              </DM.Content>
            </DM.Portal>
          </DM.Root>

          <Divider />

          {MARKS.map((m) => (
            <IconButton
              key={m.id}
              size="sm"
              icon={<m.icon size={14} />}
              label={m.label}
              keys={[...m.keys]}
              active={!!marks[m.id]}
              disabled={idle}
              onClick={() => runMark(m.cmd)}
            />
          ))}

          <Divider />

          {LISTS.map((l) => (
            <IconButton
              key={l.id}
              size="sm"
              icon={<l.icon size={14} />}
              label={l.label}
              active={blockLabel === l.label}
              disabled={idle}
              onClick={() => setBlock('affine:list', { type: l.id })}
            />
          ))}

          <IconButton
            size="sm"
            icon={<Link2 size={14} />}
            label="Link"
            keys={['⌘', 'K']}
            disabled={idle}
            onClick={() => {
              // BlockSuite owns the link popover; ⌘K on a live selection is the
              // path it already listens for, and reimplementing it here would
              // duplicate its validation and paste handling.
              const host = editor?.querySelector('editor-host') as HTMLElement | null;
              host?.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'k', code: 'KeyK', metaKey: true, ctrlKey: true, bubbles: true, composed: true,
              }));
            }}
          />
        </>
      )}

      <span className="flex-1" />

      <SegmentedControl
        aria-label="Editor mode"
        value={mode}
        onChange={(m) => onMode(m as 'page' | 'edgeless')}
        segments={[
          { value: 'page', label: 'Page', icon: <FileText size={14} /> },
          { value: 'edgeless', label: 'Edgeless', icon: <PencilRuler size={14} /> },
        ]}
      />
      {!edgeless && (
        <IconButton
          className={cn('ml-0.5')}
          icon={fullWidth ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          label={fullWidth ? 'Narrow width' : 'Full width'}
          onClick={() => onFullWidth(!fullWidth)}
        />
      )}
    </div>
  );
}
