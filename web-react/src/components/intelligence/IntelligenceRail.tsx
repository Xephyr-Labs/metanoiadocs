import { useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  Sparkles, CheckSquare, Flag, AlertTriangle, Calendar, Link as LinkIcon,
  RefreshCw, Users, LayoutTemplate, SpellCheck, PanelRightClose, PanelRightOpen,
  Copy, Clock, ChevronDown, X,
} from 'lucide-react';
import type { Intelligence } from '../../lib/docsApi';
import { useWorkspace } from '../../store/workspace';
import { cn } from '../../lib/cn';

const RAIL_KEY = 'mn-rail-open';
const MORE_KEY = 'mn-rail-more';

// Hoisted to module scope: these don't close over component state, so they
// must not be redefined (and remounted) on every render.
function Section({ icon: Icon, label, count, children }: {
  icon: typeof Sparkles; label: string; count: number; children: ReactNode;
}) {
  if (!count) return null;
  return (
    <div className="px-3.5 py-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">
        <Icon size={13} className="text-muted" /> {label}
        <span className="ml-auto tabular-nums text-faint">{count}</span>
      </div>
      <div className="space-y-1.5 text-[13px] leading-relaxed text-ink">{children}</div>
    </div>
  );
}

function Row({ id, title, onOpen }: { id: string; title: string; onOpen: (id: string) => void }) {
  return (
    <button onClick={() => onOpen(id)} className="block w-full truncate text-left text-muted transition-colors hover:text-accent">
      {title}
    </button>
  );
}

const isEmptyIntel = (data: Intelligence) =>
  !data.summary && !data.duplicateOf && !data.stale &&
  !data.related.length && !data.tasks.length && !data.decisions.length &&
  !data.risks.length && !data.deadlines.length && !data.suggestedLinks.length &&
  !data.changedDeps.length && !data.collaborators.length && !data.templates.length &&
  !data.terminology.length;

// Defensive: strip stray markdown markers from legacy-imported text so the
// summary reads as prose even before a document is normalized.
const cleanSummary = (s: string) =>
  s.replace(/[#|>]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

export function IntelligenceRail({ data, loading, error, onClose }: {
  data: Intelligence | null; loading: boolean; error: boolean; onClose?: () => void;
}) {
  const ws = useWorkspace();
  const drawer = !!onClose;
  const [open, setOpen] = useState(() => localStorage.getItem(RAIL_KEY) !== '0');
  // Both the rail and the "More signals" disclosure persist, so the rail comes
  // back the way you left it instead of re-collapsing on every doc switch.
  const [more, setMore] = useState(() => localStorage.getItem(MORE_KEY) === '1');
  const toggle = () => { const n = !open; setOpen(n); localStorage.setItem(RAIL_KEY, n ? '1' : '0'); };
  const toggleMore = () => { const n = !more; setMore(n); localStorage.setItem(MORE_KEY, n ? '1' : '0'); };

  // Inline collapsed state: a thin strip that re-opens the rail. (Drawer mode
  // has no collapsed strip — its close button dismisses the whole drawer.)
  if (!drawer && !open) {
    return (
      <button onClick={toggle} title="Show intelligence" aria-label="Show intelligence"
        className="flex h-full w-9 shrink-0 items-center justify-center border-l border-line bg-canvas text-muted hover:text-ink">
        <PanelRightOpen size={16} />
      </button>
    );
  }

  return (
    <aside className={cn(
      'flex h-full flex-col overflow-y-auto border-l border-line bg-canvas',
      drawer ? 'w-full' : 'w-72 shrink-0',
    )}>
      <div className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-line bg-canvas/90 px-3.5 py-3 backdrop-blur-md">
        <Sparkles size={15} className="text-accent" />
        <span className="text-[13px] font-semibold text-ink">Intelligence</span>
        <button onClick={onClose ?? toggle} className="ml-auto text-muted hover:text-ink"
          title={drawer ? 'Close' : 'Hide'} aria-label={drawer ? 'Close intelligence' : 'Hide intelligence'}>
          {drawer ? <X size={16} /> : <PanelRightClose size={16} />}
        </button>
      </div>

      {(data?.duplicateOf || data?.stale) && (
        <div className="flex flex-wrap gap-1.5 border-b border-line px-3.5 py-2.5 text-xs">
          {data?.duplicateOf && (
            <button onClick={() => ws.select(data.duplicateOf!.id)}
              className="flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-1 font-medium text-amber-600">
              <Copy size={11} /> Possible duplicate
            </button>
          )}
          {data?.stale && (
            <span className="flex items-center gap-1 rounded-md bg-hover px-2 py-1 text-muted">
              <Clock size={11} /> {data.stale.months} mo old
            </span>
          )}
        </div>
      )}

      {loading && !data && (
        <div role="status" className="space-y-2.5 p-3.5">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-4 animate-pulse rounded bg-hover" style={{ width: `${90 - i * 12}%` }} />)}
        </div>
      )}

      {error && !data && !loading && (
        <div className="px-3.5 py-5 text-center text-sm text-muted">Couldn&apos;t load intelligence.</div>
      )}

      {data && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="divide-y divide-line">
          {data.summary && (
            <div className="px-3.5 py-3.5">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Summary</div>
              <p className="text-[13.5px] leading-relaxed text-ink">{cleanSummary(data.summary)}</p>
            </div>
          )}

          {/* High-value, actionable signals first. */}
          <Section icon={CheckSquare} label="Tasks" count={data.tasks.length}>
            {data.tasks.map((t, i) => (
              <div key={i} className={cn('flex gap-1.5', t.checked && 'text-muted line-through')}>
                <span className="text-faint">{t.checked ? '☑' : '☐'}</span> {t.text}
              </div>
            ))}
          </Section>
          <Section icon={Flag} label="Decisions" count={data.decisions.length}>
            {data.decisions.map((d, i) => (
              <div key={i}>{d.text}{d.unresolved && <span className="ml-1 rounded bg-amber-500/10 px-1 text-[10px] text-amber-600">unresolved</span>}</div>
            ))}
          </Section>
          <Section icon={Calendar} label="Deadlines" count={data.deadlines.length}>
            {data.deadlines.map((d, i) => <div key={i}>{d.date && <b className="mr-1 tabular-nums">{d.date}</b>}{d.text}</div>)}
          </Section>
          <Section icon={Sparkles} label="Related" count={data.related.length}>
            {data.related.map((r) => <Row key={r.id} id={r.id} title={r.title} onOpen={ws.select} />)}
          </Section>
          <Section icon={LinkIcon} label="Missing links" count={data.suggestedLinks.length}>
            {data.suggestedLinks.map((l) => <Row key={l.id} id={l.id} title={l.title} onOpen={ws.select} />)}
          </Section>

          {/* Lower-value signals disclosed on demand — keeps the rail scannable. */}
          {(data.risks.length + data.changedDeps.length + data.collaborators.length + data.templates.length + data.terminology.length) > 0 && (
            <div>
              <button onClick={toggleMore} aria-expanded={more}
                className="flex w-full items-center gap-1.5 px-3.5 py-2.5 text-[12px] font-medium text-muted hover:text-ink">
                <ChevronDown size={13} className={cn('transition-transform', more && 'rotate-180')} />
                {more ? 'Fewer signals' : 'More signals'}
              </button>
              {more && (
                <div className="divide-y divide-line border-t border-line">
                  <Section icon={AlertTriangle} label="Risks" count={data.risks.length}>
                    {data.risks.map((r, i) => <div key={i}>{r.text}</div>)}
                  </Section>
                  <Section icon={RefreshCw} label="Changed deps" count={data.changedDeps.length}>
                    {data.changedDeps.map((d) => <Row key={d.id} id={d.id} title={d.title} onOpen={ws.select} />)}
                  </Section>
                  <Section icon={Users} label="Collaborators" count={data.collaborators.length}>
                    {data.collaborators.map((c) => <div key={c.id} className="text-muted">{c.name}</div>)}
                  </Section>
                  <Section icon={LayoutTemplate} label="Templates" count={data.templates.length}>
                    {data.templates.map((t) => <Row key={t.id} id={t.id} title={t.title} onOpen={ws.select} />)}
                  </Section>
                  <Section icon={SpellCheck} label="Terminology" count={data.terminology.length}>
                    {data.terminology.map((t, i) => <div key={i} className="text-muted">{t.term} → <b className="text-ink">{t.suggest}</b> <span className="tabular-nums">({t.count}×)</span></div>)}
                  </Section>
                </div>
              )}
            </div>
          )}

          {isEmptyIntel(data) && (
            <div className="px-3.5 py-8 text-center">
              <Sparkles size={20} className="mx-auto mb-2 text-faint" />
              <p className="text-[13px] font-medium text-muted">Nothing to surface yet</p>
              <p className="mt-1 text-xs text-faint">As you write, this rail highlights tasks, decisions, deadlines, related pages and missing links.</p>
            </div>
          )}
        </motion.div>
      )}
    </aside>
  );
}
