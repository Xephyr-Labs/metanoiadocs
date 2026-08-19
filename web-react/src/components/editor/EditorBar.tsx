/* Hallmark · component: editorial bar · genre: modern-minimal
 * theme: project tokens (index.css) · states: default · hover · focus · active
 * (pressed) · disabled (no editor / no selection) · loading (n/a) · error (n/a)
 * · success (n/a — formatting is its own feedback)
 */
import * as DM from '@radix-ui/react-dropdown-menu';
import { updateBlockType } from '@blocksuite/affine/blocks/note';
import { toggleLink } from '@blocksuite/affine/inlines/link';
import { getTextStyle, toggleBold, toggleCode, toggleItalic, toggleStrike } from '@blocksuite/affine/inlines/preset';
import {
  AlignHorizontalDistributeCenter, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart, AlignVerticalDistributeCenter, AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd, AlignVerticalJustifyStart,
  Bold, Check, ChevronDown, Code, Download, FileText, Italic, Link2, List, ListOrdered,
  ListTodo, Maximize2, Minimize2, PencilRuler, Presentation, Strikethrough,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { applyAlign, selectedCount } from '../../editor/designAlign';
import { exportCanvasPng } from '../../editor/designExport';
import { toast } from '../../lib/toast';
import { MIN_FOR, type AlignMode } from '../../lib/align';
import type { EditorMode } from '../../lib/types';
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

/** Align first, then distribute — the order everyone's muscle memory expects. */
const ALIGNMENTS: { mode: AlignMode; label: string; icon: typeof Bold }[] = [
  { mode: 'left', label: 'Align left', icon: AlignHorizontalJustifyStart },
  { mode: 'center-x', label: 'Align horizontal centres', icon: AlignHorizontalJustifyCenter },
  { mode: 'right', label: 'Align right', icon: AlignHorizontalJustifyEnd },
  { mode: 'top', label: 'Align top', icon: AlignVerticalJustifyStart },
  { mode: 'middle', label: 'Align vertical centres', icon: AlignVerticalJustifyCenter },
  { mode: 'bottom', label: 'Align bottom', icon: AlignVerticalJustifyEnd },
  { mode: 'distribute-x', label: 'Distribute horizontally', icon: AlignHorizontalDistributeCenter },
  { mode: 'distribute-y', label: 'Distribute vertically', icon: AlignVerticalDistributeCenter },
];

const Divider = () => <span className="mx-1 h-4 w-px shrink-0 bg-line" aria-hidden />;

interface Props {
  /** The mounted `affine-editor-container`, or null before it loads. */
  editor: Element | null;
  mode: EditorMode;
  /** A design has no page view — the toggle drops the Page segment. */
  design?: boolean;
  onMode: (m: EditorMode) => void;
  fullWidth: boolean;
  onFullWidth: (v: boolean) => void;
}

/**
 * Persistent formatting bar. BlockSuite only shows its own toolbar once text is
 * selected, which leaves every formatting control invisible until you already
 * know it exists — this is the always-there entry point. It drives the same
 * command chain the floating toolbar does, so the two never disagree.
 */
export function EditorBar({ editor, mode, design, onMode, fullWidth, onFullWidth }: Props) {
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const [blockLabel, setBlockLabel] = useState<string | null>(null);
  // Slides is the same canvas, so both hide the block-formatting half of the bar.
  const edgeless = mode !== 'page';
  // No caret in the document means every command below is a no-op. Say so with
  // the disabled state rather than letting the buttons look live and do nothing.
  const idle = blockLabel === null;

  // How many canvas elements are selected, which is all the align buttons need
  // to know. Polled rather than subscribed: the gfx controller does not exist
  // for a beat after the canvas mounts, and SlidesRail already reads this canvas
  // on a tick. Upgrade to `gfx.selection.slots.updated` if it ever feels laggy.
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    if (!editor || !edgeless) { setSelected(0); return; }
    const read = () => setSelected(selectedCount(editor));
    read();
    const t = setInterval(read, 400);
    return () => clearInterval(t);
  }, [editor, edgeless]);

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
          // `selection.find` takes a selection CLASS, not a string — passing
          // 'text' silently returns undefined, which read as "no caret" and
          // left every control disabled. Match on the plain type instead.
          const blockId = s.selection?.value?.find?.((sel: any) => sel.type === 'text')?.blockId;
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
            // BlockSuite's own command, not a synthesised ⌘K — a dispatched
            // KeyboardEvent never reached its keymap, so this button did nothing.
            onClick={() => runMark(toggleLink)}
          />
        </>
      )}

      {edgeless && (
        <span className="flex items-center gap-0.5">
          {ALIGNMENTS.map(({ mode, label, icon: Icon }, i) => (
            <span key={mode} className="flex items-center">
              {i === 6 && <Divider />}
              <IconButton
                size="sm"
                icon={<Icon size={16} />}
                label={label}
                disabled={selected < MIN_FOR(mode)}
                onClick={() => applyAlign(editor, mode)}
              />
            </span>
          ))}
        </span>
      )}

      {edgeless && (
        <>
          <Divider />
          <IconButton
            size="sm"
            icon={<Download size={16} />}
            label="Export as PNG"
            onClick={async () => {
              if (!(await exportCanvasPng(editor))) toast('Nothing to export from this canvas yet');
            }}
          />
        </>
      )}

      <span className="flex-1" />

      <SegmentedControl
        aria-label="Editor mode"
        value={mode}
        onChange={(m) => onMode(m as EditorMode)}
        segments={[
          ...(design ? [] : [{ value: 'page', label: 'Page', icon: <FileText size={14} /> }]),
          { value: 'edgeless', label: 'Edgeless', icon: <PencilRuler size={14} /> },
          { value: 'slides', label: 'Slides', icon: <Presentation size={14} /> },
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
