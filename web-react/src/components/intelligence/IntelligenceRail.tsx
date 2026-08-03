import { useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  Sparkles, CheckSquare, Flag, AlertTriangle, Calendar, Link as LinkIcon,
  RefreshCw, Users, LayoutTemplate, SpellCheck, PanelRightClose, PanelRightOpen,
  Copy, Clock,
} from 'lucide-react';
import type { Intelligence } from '../../lib/docsApi';
import { useWorkspace } from '../../store/workspace';

const RAIL_KEY = 'mn-rail-open';

// Hoisted to module scope: these don't close over component state, so they
// must not be redefined (and remounted) on every render.
function Section({ icon: Icon, label, count, children }: {
  icon: typeof Sparkles; label: string; count: number; children: ReactNode;
}) {
  if (!count) return null;
  return (
    <div className="border-b border-line px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
        <Icon size={13} /> {label} <span className="ml-auto tabular-nums">{count}</span>
      </div>
      <div className="space-y-1 text-sm">{children}</div>
    </div>
  );
}

function Row({ id, title, onOpen }: { id: string; title: string; onOpen: (id: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      <button onClick={() => onOpen(id)} className="truncate text-left hover:text-accent">{title}</button>
    </div>
  );
}

const isEmptyIntel = (data: Intelligence) =>
  !data.summary && !data.duplicateOf && !data.stale &&
  !data.related.length && !data.tasks.length && !data.decisions.length &&
  !data.risks.length && !data.deadlines.length && !data.suggestedLinks.length &&
  !data.changedDeps.length && !data.collaborators.length && !data.templates.length &&
  !data.terminology.length;

export function IntelligenceRail({ data, loading, error }: { data: Intelligence | null; loading: boolean; error: boolean }) {
  const ws = useWorkspace();
  const [open, setOpen] = useState(() => localStorage.getItem(RAIL_KEY) !== '0');
  const toggle = () => { const n = !open; setOpen(n); localStorage.setItem(RAIL_KEY, n ? '1' : '0'); };

  if (!open) {
    return (
      <button onClick={toggle} title="Show intelligence" aria-label="Show intelligence"
        className="flex w-9 shrink-0 items-center justify-center border-l border-line bg-canvas text-muted hover:text-ink">
        <PanelRightOpen size={16} />
      </button>
    );
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-l border-line bg-canvas">
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2 text-xs font-semibold">
        <Sparkles size={13} className="text-accent" /> Intelligence
        <button onClick={toggle} className="ml-auto text-muted hover:text-ink" title="Hide" aria-label="Hide intelligence">
          <PanelRightClose size={16} />
        </button>
      </div>

      {(data?.duplicateOf || data?.stale) && (
        <div className="flex flex-wrap gap-1 border-b border-line px-3 py-2 text-xs">
          {data?.duplicateOf && (
            <button onClick={() => ws.select(data.duplicateOf!.id)}
              className="flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-600">
              <Copy size={11} /> Possible duplicate
            </button>
          )}
          {data?.stale && (
            <span className="flex items-center gap-1 rounded bg-hover px-1.5 py-0.5 text-muted">
              <Clock size={11} /> {data.stale.months} mo old
            </span>
          )}
        </div>
      )}

      {loading && !data && (
        <div role="status" className="space-y-2 p-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-4 animate-pulse rounded bg-hover" />)}
        </div>
      )}

      {error && !data && !loading && (
        <div className="px-3 py-4 text-center text-sm text-muted">Couldn&apos;t load intelligence.</div>
      )}

      {data && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          {data.summary && (
            <div className="border-b border-line px-3 py-2 text-sm text-muted"><span className="mb-1 block text-xs font-medium">Summary</span>{data.summary}</div>
          )}
          <Section icon={Sparkles} label="Related" count={data.related.length}>
            {data.related.map((r) => <Row key={r.id} id={r.id} title={r.title} onOpen={ws.select} />)}
          </Section>
          <Section icon={CheckSquare} label="Tasks" count={data.tasks.length}>
            {data.tasks.map((t, i) => (
              <div key={i} className={t.checked ? 'text-muted line-through' : ''}>
                {t.checked ? '☑' : '☐'} {t.text}
              </div>
            ))}
          </Section>
          <Section icon={Flag} label="Decisions" count={data.decisions.length}>
            {data.decisions.map((d, i) => (
              <div key={i}>{d.text}{d.unresolved && <span className="ml-1 rounded bg-amber-500/10 px-1 text-[10px] text-amber-600">unresolved</span>}</div>
            ))}
          </Section>
          <Section icon={AlertTriangle} label="Risks" count={data.risks.length}>
            {data.risks.map((r, i) => <div key={i}>{r.text}</div>)}
          </Section>
          <Section icon={Calendar} label="Deadlines" count={data.deadlines.length}>
            {data.deadlines.map((d, i) => <div key={i}>{d.date && <b className="mr-1">{d.date}</b>}{d.text}</div>)}
          </Section>
          <Section icon={LinkIcon} label="Missing links" count={data.suggestedLinks.length}>
            {data.suggestedLinks.map((l) => <Row key={l.id} id={l.id} title={l.title} onOpen={ws.select} />)}
          </Section>
          <Section icon={RefreshCw} label="Changed deps" count={data.changedDeps.length}>
            {data.changedDeps.map((d) => <Row key={d.id} id={d.id} title={d.title} onOpen={ws.select} />)}
          </Section>
          <Section icon={Users} label="Collaborators" count={data.collaborators.length}>
            {data.collaborators.map((c) => <div key={c.id}>{c.name}</div>)}
          </Section>
          <Section icon={LayoutTemplate} label="Templates" count={data.templates.length}>
            {data.templates.map((t) => <Row key={t.id} id={t.id} title={t.title} onOpen={ws.select} />)}
          </Section>
          <Section icon={SpellCheck} label="Terminology" count={data.terminology.length}>
            {data.terminology.map((t, i) => <div key={i} className="text-muted">{t.term} → <b>{t.suggest}</b> ({t.count}×)</div>)}
          </Section>
          {isEmptyIntel(data) && (
            <div className="px-3 py-4 text-center text-sm text-muted">No signals yet.</div>
          )}
        </motion.div>
      )}
    </aside>
  );
}
