/* Hallmark · component: version-history modal · genre: modern-minimal
 * theme: project tokens (index.css) · states: default · hover · focus-visible ·
 * active · disabled (while restoring) · loading (rail + preview) · error
 * (inline, keeps the list) · success (restored) · empty (no snapshots yet)
 *
 * Laid out against the real AFFiNE screen (self-hosted 0.26.6, read Aug 2026):
 * a centred modal over the dimmed workspace, the version rendered on a stack of
 * sheets with the selected time on its header, a dated rail on the right, and
 * "Back to doc" / "Restore current version" along the bottom.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Check, ChevronDown, Copy, History, Loader2, MoreHorizontal, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { docsApi, type VersionRow } from '../../lib/docsApi';
import { avatarFor } from '../../lib/avatar';
import { groupByDay, timeLabel } from '../../lib/versionGroups';
import { cn } from '../../lib/cn';
import { LazyEditor } from '../../editor/LazyEditor';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useAuth } from '../../store/auth';
import { useWorkspace } from '../../store/workspace';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { IconButton } from '../ui/IconButton';
import { Menu } from '../ui/Menu';
import { Modal } from '../ui/Modal';
import { PageSkeleton } from '../ui/Skeleton';

/** A snapshot's own label, sentence-cased — the server writes 'autosave'. */
const labelOf = (v: VersionRow) => {
  const label = (v.label || 'autosave').trim();
  return label.charAt(0).toUpperCase() + label.slice(1);
};

const HELP_DISMISSED = 'mn-history-help-dismissed';

function RailRow({ version, selected, onSelect }: { version: VersionRow; selected: boolean; onSelect: () => void }) {
  // An automatic snapshot is taken by the document, not by a person: naming a
  // "Someone" there invents an author the row does not know.
  const who = version.author || version.author_email || null;
  const avatar = who ? avatarFor(who) : null;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected}
      className={cn(
        'flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left transition-colors duration-120',
        selected ? 'bg-selected' : 'hover:bg-hover',
      )}
    >
      <span className="flex items-baseline gap-1.5">
        <span className="text-sm text-ink">{timeLabel(new Date(version.created_at))}</span>
        {/* AFFiNE tags the version you are LOOKING at, not the newest one —
            which is what makes "Restore current version" below read straight. */}
        {selected && <span className="text-2xs text-accent">· Current</span>}
      </span>
      <span className="flex min-w-0 items-center gap-1.5">
        {avatar ? (
          <span
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-3xs font-semibold text-white"
            style={{ background: avatar.color }}
          >
            {avatar.initials}
          </span>
        ) : (
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-surface text-faint ring-1 ring-inset ring-line">
            <History size={9} />
          </span>
        )}
        <span className="min-w-0 truncate text-2xs text-faint">{who ?? labelOf(version)}</span>
      </span>
    </button>
  );
}

/**
 * Version history: the snapshot rendered as the page it was, a dated timeline
 * beside it, and one button that puts it back.
 *
 * The preview is the real editor over a detached copy of the archived state
 * (see `mountEditor`'s snapshot mode) rather than decoded text, because a
 * version you cannot recognise is a version you cannot choose between.
 */
function HistoryPanel({ docId }: { docId: string }) {
  const ws = useWorkspace();
  const auth = useAuth();
  const page = ws.pages[docId];

  // A reference chip reads existence off the page index it is given; without one
  // every "@" mention in an old version renders struck through as a deleted
  // page. The preview cannot create pages, so the "@" menu stays off — this is
  // the index only.
  const pages = useMemo(
    () => Object.values(ws.pages).map((p) => ({ id: p.id, title: p.title, icon: p.icon })),
    [ws.pages],
  );
  const linkTargets = useCallback(() => pages, [pages]);

  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [state, setState] = useState<Uint8Array | null>(null);
  const [loadingState, setLoadingState] = useState(false);
  const [busy, setBusy] = useState<null | 'restore' | 'copy' | 'snapshot'>(null);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [helpOpen, setHelpOpen] = useState(() => localStorage.getItem(HELP_DISMISSED) !== '1');
  const backRef = useRef<HTMLButtonElement>(null);
  // A phone has room for one column, not two: the timeline is the first screen
  // and a version opens over it, with a way back. Side by side, either the list
  // or the page would be too narrow to read.
  const isMobile = useMediaQuery('(max-width: 767px)');
  const [pane, setPane] = useState<'list' | 'preview'>('list');

  const load = useCallback(
    async (keepSelection = false) => {
      const rows = await docsApi.versions(docId).catch(() => [] as VersionRow[]);
      setVersions(rows);
      setSelectedId((cur) => (keepSelection && cur && rows.some((r) => r.id === cur) ? cur : rows[0]?.id ?? null));
    },
    [docId],
  );

  useEffect(() => { load(); }, [load]);
  useEffect(() => { backRef.current?.focus(); }, []);

  // Esc leaves history — the same reflex every other overlay in the app answers to.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !confirming) ws.closeHistory(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ws, confirming]);

  // Fetch the selected snapshot's bytes. Snapshots are immutable, so a version
  // already looked at is served from the browser cache on the way back.
  useEffect(() => {
    if (!selectedId) { setState(null); return; }
    let alive = true;
    setLoadingState(true);
    docsApi
      .versionState(docId, selectedId)
      .then((bytes) => { if (alive) { setState(bytes); setErr(null); } })
      .catch((e) => { if (alive) { setState(null); setErr(e instanceof Error ? e.message : 'Could not load that version.'); } })
      .finally(() => { if (alive) setLoadingState(false); });
    return () => { alive = false; };
  }, [docId, selectedId]);

  const selected = versions?.find((v) => v.id === selectedId) ?? null;

  const restoreInPlace = async () => {
    if (!selectedId) return;
    setBusy('restore');
    setErr(null);
    try {
      await docsApi.restoreVersionInPlace(docId, selectedId);
      setConfirming(false);
      setDone('Page restored.');
      setPane('list');
      await ws.refresh();
      // The "Before restore" snapshot is now the newest row, so the list has to
      // come back — that entry is the undo.
      await load(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not restore that version.');
      setConfirming(false);
    } finally {
      setBusy(null);
    }
  };

  const restoreAsCopy = async () => {
    if (!selectedId) return;
    setBusy('copy');
    setErr(null);
    try {
      const row = await docsApi.restoreVersion(docId, selectedId);
      await ws.refresh();
      ws.closeHistory();
      ws.select(row.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not open that version as a copy.');
    } finally {
      setBusy(null);
    }
  };

  const snapshotNow = async () => {
    setBusy('snapshot');
    setErr(null);
    try {
      await docsApi.snapshot(docId, 'Manual save');
      setDone('Snapshot saved.');
      await load(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save a snapshot.');
    } finally {
      setBusy(null);
    }
  };

  // Confirmations fade out on their own; an error stays until the next attempt.
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(null), 2600);
    return () => clearTimeout(t);
  }, [done]);

  const dismissHelp = () => { setHelpOpen(false); localStorage.setItem(HELP_DISMISSED, '1'); };
  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const groups = groupByDay(versions ?? []);
  const showPreview = !isMobile || pane === 'preview';
  const showRail = !isMobile || pane === 'list';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.14 }}
      onClick={(e) => { if (e.target === e.currentTarget) ws.closeHistory(); }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay backdrop-blur-[2px] md:p-6"
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={`Version history · ${page?.title ?? 'Page'}`}
        initial={{ opacity: 0, scale: 0.985, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.985, y: 8 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className={cn(
          'flex h-full w-full flex-col overflow-hidden bg-canvas',
          'md:h-[88vh] md:max-w-[1120px] md:rounded-xl md:border md:border-line md:shadow-modal',
        )}
      >
        <div className="flex min-h-0 flex-1">
          {/* The version sits on a stack of sheets: the ground is a shade off the
              canvas so the page reads as something held up to the light, not as
              the live document you were just editing. */}
          <div className={cn('relative min-w-0 flex-1 bg-surface-2 md:pt-8', showPreview ? 'flex' : 'hidden')}>
            <span aria-hidden className="absolute left-1/2 top-1 hidden h-10 w-[calc(100%-10rem)] -translate-x-1/2 rounded-t-lg border border-line bg-canvas/50 md:block" />
            <span aria-hidden className="absolute left-1/2 top-[18px] hidden h-10 w-[calc(100%-6.5rem)] -translate-x-1/2 rounded-t-lg border border-line bg-canvas/80 md:block" />

            <div className="relative mx-auto flex h-full w-full flex-col overflow-hidden border-line bg-canvas md:w-[calc(100%-3rem)] md:rounded-t-lg md:border md:border-b-0">
              <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
                {isMobile && (
                  <IconButton size="sm" icon={<ArrowLeft size={16} />} label="Back to versions" onClick={() => setPane('list')} />
                )}
                <span className="min-w-0 truncate text-sm font-medium text-ink">{page?.title || 'Untitled'}</span>
                {selected && (
                  <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-2xs tabular-nums text-muted">
                    {timeLabel(new Date(selected.created_at))}
                  </span>
                )}
              </div>

              <div className="scrollarea min-h-0 flex-1 overflow-y-auto">
                {err && !loadingState && <p className="mt-6 px-6 text-sm text-danger">{err}</p>}
                {loadingState || !state ? (
                  !err && <div className="px-6 pt-8"><PageSkeleton /></div>
                ) : (
                  <motion.div
                    // Cross-fade between versions: the sheet is the same, only
                    // the content changed, and a slide would read as navigation.
                    key={selectedId}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                    className="pb-16 pt-4"
                  >
                    {/* No heading of our own: the snapshot carries the title the
                        page had then, which is part of what is being previewed. */}
                    <LazyEditor
                      key={selectedId ?? 'none'}
                      docId={docId}
                      title={page?.title ?? 'Untitled'}
                      mode="page"
                      userName={auth.user?.name ?? 'You'}
                      snapshot={state}
                      pages={linkTargets}
                      // Never called: a read-only store cannot type an "@".
                      // Present because the reference extensions come as one piece.
                      createPage={async () => null}
                      onOpenDoc={(id) => { ws.closeHistory(); ws.select(id); }}
                    />
                  </motion.div>
                )}
              </div>
            </div>
          </div>

          <aside
            className={cn(
              'scrollarea shrink-0 overflow-y-auto border-line bg-canvas md:w-[248px] md:border-l',
              showRail ? 'w-full' : 'hidden',
            )}
            aria-label="Versions"
          >
            <h2 className="px-4 py-3 text-sm font-semibold text-ink">Version history</h2>

            <AnimatePresence initial={false}>
              {helpOpen && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden px-3"
                >
                  <div className="rounded-md bg-surface p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-2xs font-semibold uppercase tracking-wide text-faint">Help info</p>
                      <button
                        type="button"
                        onClick={dismissHelp}
                        aria-label="Dismiss"
                        className="-mr-1 -mt-1 rounded p-0.5 text-faint transition-colors duration-120 hover:bg-hover hover:text-ink"
                      >
                        <X size={13} />
                      </button>
                    </div>
                    <p className="mt-1.5 text-2xs leading-relaxed text-muted">
                      A version is saved every few minutes of editing, and whenever someone takes one by hand.
                      The <span className="text-ink">last 50</span> are kept for this page.
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {versions === null ? (
              <div className="flex justify-center py-10"><Loader2 size={18} className="animate-spin text-faint" /></div>
            ) : versions.length === 0 ? (
              <EmptyState icon={History} title="No versions yet" hint="Snapshots are saved as you edit, and whenever you ask for one." compact />
            ) : (
              <div className="p-2">
                {groups.map((group) => {
                  const shut = collapsed.has(group.key);
                  return (
                    <section key={group.key} className="pb-1">
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.key)}
                        aria-expanded={!shut}
                        className="flex w-full items-center gap-1 rounded px-1 py-1.5 text-left text-2xs font-medium text-muted transition-colors duration-120 hover:bg-hover"
                      >
                        <ChevronDown size={12} className={cn('shrink-0 transition-transform duration-180', shut && '-rotate-90')} />
                        {group.label}
                      </button>
                      {!shut && (
                        // The guide line ties a day's versions together, so the
                        // rail reads as one timeline rather than stacked lists.
                        <div className="ml-[9px] space-y-px border-l border-line pl-2">
                          {group.rows.map((v) => (
                            <RailRow
                              key={v.id}
                              version={v}
                              selected={v.id === selectedId}
                              onSelect={() => { setSelectedId(v.id); setPane('preview'); }}
                            />
                          ))}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </aside>
        </div>

        <footer className="flex h-14 shrink-0 items-center gap-2 border-t border-line px-3">
          <Button ref={backRef} onClick={ws.closeHistory}>Back to doc</Button>
          <div className="ml-auto flex min-w-0 items-center gap-1.5">
            <AnimatePresence>
              {done && (
                <motion.span
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-1 truncate text-2xs text-accent"
                >
                  <Check size={13} /> {done}
                </motion.span>
              )}
            </AnimatePresence>
            <Menu
              align="end"
              width={232}
              items={[
                { icon: Copy, label: 'Open this version as a copy', onSelect: () => { restoreAsCopy(); } },
                { icon: History, label: 'Snapshot the current page', separatorBefore: true, onSelect: () => { snapshotNow(); } },
              ]}
              trigger={<span><IconButton icon={<MoreHorizontal size={18} />} label="More history actions" /></span>}
            />
            <Button
              variant="primary"
              disabled={!selected || busy !== null}
              leftIcon={busy === 'restore' ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
              onClick={() => setConfirming(true)}
            >
              <span className="hidden sm:inline">Restore current version</span>
              <span className="sm:hidden">Restore</span>
            </Button>
          </div>
        </footer>
      </motion.div>

      <Modal
        open={confirming}
        onOpenChange={(v) => !v && setConfirming(false)}
        width={400}
        title={<><RotateCcw size={16} className="text-muted" /> Restore this version?</>}
      >
        <div className="p-4">
          <p className="text-sm text-muted">
            This page goes back to how it was
            {selected ? ` at ${timeLabel(new Date(selected.created_at))}` : ''}, for everyone reading it.
            The version you have now is saved first as <span className="text-ink">Before restore</span>, so you can come straight back.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy === 'restore'}>Cancel</Button>
            <Button
              variant="primary"
              onClick={restoreInPlace}
              disabled={busy === 'restore'}
              leftIcon={busy === 'restore' ? <Loader2 size={14} className="animate-spin" /> : undefined}
            >
              Restore
            </Button>
          </div>
        </div>
      </Modal>
    </motion.div>
  );
}

export function HistoryView() {
  const docId = useWorkspace().historyDocId;
  return (
    <AnimatePresence>
      {docId && <HistoryPanel key={docId} docId={docId} />}
    </AnimatePresence>
  );
}
