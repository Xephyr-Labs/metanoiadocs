/* Hallmark · component: formula + rollup settings · genre: modern-minimal
 * theme: project tokens (index.css)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * states: default · focus · valid · invalid (named) · empty · no relation yet
 */
import { useEffect, useState } from 'react';
import { AlertCircle, Sigma } from 'lucide-react';
import { cn } from '../../../lib/cn';
import { checkFormula } from '../../../lib/formula';
import { ROLLUP_LABEL, type RollupFn } from '../../../lib/computed';
import { tasksApi, type PropRow } from '../../../lib/tasksApi';
import { field, selectField } from '../../ui/styles';

/**
 * What a formula computes.
 *
 * The expression is checked as it is typed and the fault is named underneath —
 * a formula that silently evaluates to nothing is indistinguishable from one
 * nobody finished, and the person who can fix it is the person typing.
 */
export function FormulaEditor({ prop, onPatch }: {
  prop: PropRow;
  onPatch: (id: string, body: { config: PropRow['config'] }) => void;
}) {
  const [draft, setDraft] = useState(prop.config?.expression ?? '');
  const error = checkFormula(draft);

  return (
    <div className="ml-9 flex flex-col gap-1 pb-1.5">
      <div className="flex items-center gap-2">
        <Sigma size={14} className="shrink-0 text-faint" />
        <input
          className={cn(field, 'font-mono text-xs', error && 'ring-danger-strong focus:ring-danger-strong')}
          placeholder='prop("Points") * 2'
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { if (!error && draft !== (prop.config?.expression ?? '')) onPatch(prop.id, { config: { expression: draft } }); }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          spellCheck={false}
        />
      </div>
      {error ? (
        <p className="flex items-center gap-1.5 pl-6 text-2xs text-danger-strong">
          <AlertCircle size={11} className="shrink-0" /> {error}
        </p>
      ) : (
        <p className="pl-6 text-2xs text-faint">
          Other columns are <code className="font-mono">prop(&quot;Name&quot;)</code>. Try{' '}
          <code className="font-mono">if(empty(prop(&quot;Due&quot;)), &quot;unscheduled&quot;, dateDiff(now(), prop(&quot;Due&quot;)))</code>.
        </p>
      )}
    </div>
  );
}

/**
 * What a rollup gathers, and how it reduces it.
 *
 * Three choices in a row, because they only make sense together: which
 * relation to follow, which of the linked database's properties to read, and
 * what to do with the values. Without a relation there is nothing to follow,
 * so it says that rather than offering the other two against an empty list.
 */
export function RollupEditor({ prop, relations, onPatch }: {
  prop: PropRow;
  /** This database's relation properties — what a rollup can follow. */
  relations: PropRow[];
  onPatch: (id: string, body: { config: PropRow['config'] }) => void;
}) {
  const config = prop.config ?? {};
  // The linked database's columns, fetched when one is chosen. Only this
  // editor needs them, and only while it is open, so it asks rather than
  // making every caller carry another database's property list.
  const targetProject = relations.find((r) => r.id === config.relation)?.target_project_id ?? null;
  const [targetProps, setTargetProps] = useState<PropRow[]>([]);
  useEffect(() => {
    if (!targetProject) { setTargetProps([]); return; }
    let alive = true;
    tasksApi.props(targetProject).then((rows) => alive && setTargetProps(rows)).catch(() => {});
    return () => { alive = false; };
  }, [targetProject]);
  const set = (patch: Partial<NonNullable<PropRow['config']>>) =>
    onPatch(prop.id, { config: { ...config, ...patch } });

  if (!relations.length) {
    return (
      <p className="ml-9 pb-1.5 text-2xs text-faint">
        A rollup reads through a relation — add a relation property first.
      </p>
    );
  }

  return (
    <div className="ml-9 flex flex-wrap items-center gap-2 pb-1.5">
      <select
        aria-label="Relation to follow"
        className={cn(selectField, 'w-40')}
        value={config.relation ?? ''}
        onChange={(e) => set({ relation: e.target.value, target: '' })}
      >
        <option value="">Through…</option>
        {relations.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
      </select>
      <select
        aria-label="Property to read"
        className={cn(selectField, 'w-40')}
        value={config.target ?? ''}
        disabled={!config.relation}
        onChange={(e) => set({ target: e.target.value })}
      >
        <option value="">Which column…</option>
        {targetProps.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>
      <select
        aria-label="How to reduce it"
        className={cn(selectField, 'w-48')}
        value={config.fn ?? 'count'}
        onChange={(e) => set({ fn: e.target.value as RollupFn })}
      >
        {(Object.keys(ROLLUP_LABEL) as RollupFn[]).map((fn) => (
          <option key={fn} value={fn}>{ROLLUP_LABEL[fn]}</option>
        ))}
      </select>
    </div>
  );
}
