/* Hallmark · component: per-database automations · genre: modern-minimal
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * theme: project tokens (index.css)
 * states: loading · empty · status rule · manual rule (quick action) ·
 *         disabled rule · confirming delete
 * note: one sentence per rule, read left to right — "when status becomes Done,
 *       set progress to 100". A form that reads as a sentence needs no legend.
 */
import { useEffect, useState } from 'react';
import { Filter, Plus, Trash2, Zap } from 'lucide-react';
import { cn } from '../../lib/cn';
import type { UserRow } from '../../lib/docsApi';
import type { Filter as FilterClause, FilterOp } from '../../lib/taskFilter';
import {
  STATUSES,
  STATUS_LABEL,
  tasksApi,
  type AutomationAction,
  type AutomationRow,
  type AutomationTrigger,
  type SprintRow,
  type TaskKindRow,
  type TaskStatus,
} from '../../lib/tasksApi';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Modal } from '../ui/Modal';
import { Switch } from '../ui/Switch';
import { field as fieldStyle, selectField } from '../ui/styles';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  kinds: TaskKindRow[];
  sprints: SprintRow[];
  users: UserRow[];
}

const ACTION_LABEL: Record<AutomationAction['type'], string> = {
  assign: 'assign it to',
  status: 'set status to',
  kind: 'set type to',
  sprint: 'move it to',
  priority: 'set priority to',
  points: 'set points to',
  progress: 'set progress to',
};

/** A freshly added action, with a value that already means something — an
 *  action you have to fill in before it does anything is a half-saved rule. */
function blankAction(type: AutomationAction['type'], kinds: TaskKindRow[]): AutomationAction {
  switch (type) {
    case 'assign': return { type, userIds: [] };
    case 'status': return { type, value: 'done' };
    case 'kind': return { type, value: kinds[0]?.key ?? 'task' };
    case 'sprint': return { type, value: 'active' };
    case 'priority': return { type, value: 1 };
    case 'points': return { type, value: 1 };
    case 'progress': return { type, value: 100 };
  }
}

function ActionRow({ action, kinds, sprints, users, onChange, onRemove }: {
  action: AutomationAction;
  kinds: TaskKindRow[];
  sprints: SprintRow[];
  users: UserRow[];
  onChange: (a: AutomationAction) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-[104px] shrink-0 text-right text-xs text-muted">{ACTION_LABEL[action.type]}</span>

      {action.type === 'assign' && (
        // ponytail: one person per assign action. The stored shape is already a
        // list, so a multi-picker drops in here when someone wants two.
        <select
          aria-label="Assign to"
          className={cn(selectField, 'h-7 flex-1 text-xs')}
          value={action.userIds[0] ?? ''}
          onChange={(e) => onChange({ type: 'assign', userIds: e.target.value ? [e.target.value] : [] })}
        >
          <option value="">nobody</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
        </select>
      )}

      {action.type === 'status' && (
        <select
          aria-label="Status"
          className={cn(selectField, 'h-7 flex-1 text-xs')}
          value={action.value}
          onChange={(e) => onChange({ type: 'status', value: e.target.value as TaskStatus })}
        >
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      )}

      {action.type === 'kind' && (
        <select
          aria-label="Type"
          className={cn(selectField, 'h-7 flex-1 text-xs')}
          value={action.value}
          onChange={(e) => onChange({ type: 'kind', value: e.target.value })}
        >
          {kinds.map((k) => <option key={k.id} value={k.key}>{k.label}</option>)}
        </select>
      )}

      {action.type === 'sprint' && (
        <select
          aria-label="Sprint"
          className={cn(selectField, 'h-7 flex-1 text-xs')}
          value={action.value ?? ''}
          onChange={(e) => onChange({ type: 'sprint', value: e.target.value || null })}
        >
          {/* "the active sprint" outlives the sprint the rule was written in,
              which is why it is the default and sits first. */}
          <option value="active">the active sprint</option>
          <option value="">the backlog</option>
          {sprints.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}

      {(action.type === 'priority' || action.type === 'points' || action.type === 'progress') && (
        <input
          type="number"
          aria-label={ACTION_LABEL[action.type]}
          className={cn(fieldStyle, 'h-7 flex-1 text-xs tabular-nums')}
          min={action.type === 'progress' ? 0 : undefined}
          max={action.type === 'progress' ? 100 : undefined}
          value={action.value ?? ''}
          onChange={(e) => onChange({ ...action, value: e.target.value === '' ? null : Number(e.target.value) } as AutomationAction)}
        />
      )}

      <IconButton icon={<Trash2 size={14} />} label="Remove this action" onClick={onRemove} />
    </div>
  );
}

/** The columns a rule can gate on, and the operators each one accepts. Mirrors
 *  fieldValue() in server/src/automations.js — a field the server cannot read
 *  never matches, so offering one here would be offering a broken rule. */
const CONDITION_FIELDS: { key: string; label: string; ops: FilterOp[] }[] = [
  { key: 'status',   label: 'Status',   ops: ['is', 'is_not', 'is_any_of', 'is_none_of'] },
  { key: 'kind',     label: 'Type',     ops: ['is', 'is_not', 'is_any_of', 'is_none_of'] },
  { key: 'title',    label: 'Title',    ops: ['contains', 'is', 'is_not'] },
  { key: 'priority', label: 'Priority', ops: ['is', 'gt', 'lt'] },
  { key: 'points',   label: 'Points',   ops: ['is', 'gt', 'lt', 'is_empty', 'is_not_empty'] },
  { key: 'progress', label: 'Progress', ops: ['is', 'gt', 'lt'] },
  { key: 'assignee', label: 'Assignee', ops: ['is', 'is_not', 'is_empty', 'is_not_empty'] },
  { key: 'sprint',   label: 'Sprint',   ops: ['is', 'is_not', 'is_empty', 'is_not_empty'] },
  { key: 'due_at',   label: 'Due',      ops: ['on', 'before', 'after', 'is_empty', 'is_not_empty'] },
];

const OP_TEXT: Partial<Record<FilterOp, string>> = {
  is: 'is', is_not: 'is not', is_any_of: 'is any of', is_none_of: 'is none of',
  contains: 'contains', is_empty: 'is empty', is_not_empty: 'is not empty',
  on: 'on', before: 'before', after: 'after', gt: 'more than', lt: 'less than',
};

/** Ops that need no value — rendering a box beside them invites typing into
 *  something that is ignored. */
const NO_VALUE: FilterOp[] = ['is_empty', 'is_not_empty'];

function ConditionRow({ clause, kinds, sprints, users, onChange, onRemove }: {
  clause: FilterClause;
  kinds: TaskKindRow[];
  sprints: SprintRow[];
  users: UserRow[];
  onChange: (c: FilterClause) => void;
  onRemove: () => void;
}) {
  const field = CONDITION_FIELDS.find((f) => f.key === clause.field) ?? CONDITION_FIELDS[0];
  const needsValue = !NO_VALUE.includes(clause.op);

  // The value control follows the field: a status is a list, a priority is a
  // number, a title is free text. A single text box for all of them is how you
  // get rules that quietly never match.
  const options =
    field.key === 'status' ? STATUSES.map((v) => ({ value: v, label: STATUS_LABEL[v] }))
    : field.key === 'kind' ? kinds.map((k) => ({ value: k.key, label: k.label }))
    : field.key === 'sprint' ? sprints.map((sp) => ({ value: sp.id, label: sp.name }))
    : field.key === 'assignee' ? users.map((u) => ({ value: u.id, label: u.name || u.email }))
    : null;

  return (
    <div className="flex items-center gap-1.5">
      <span className="w-[104px] shrink-0 text-right text-xs text-muted">only when</span>
      <select
        aria-label="Condition field"
        className={cn(selectField, 'h-7 w-[104px] shrink-0 text-xs')}
        value={field.key}
        onChange={(e) => {
          const next = CONDITION_FIELDS.find((f) => f.key === e.target.value)!;
          onChange({ ...clause, field: next.key, op: next.ops[0], value: '' });
        }}
      >
        {CONDITION_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
      </select>
      <select
        aria-label="Condition operator"
        className={cn(selectField, 'h-7 w-[104px] shrink-0 text-xs')}
        value={clause.op}
        onChange={(e) => onChange({ ...clause, op: e.target.value as FilterOp })}
      >
        {field.ops.map((op) => <option key={op} value={op}>{OP_TEXT[op] ?? op}</option>)}
      </select>

      {needsValue && (options
        ? (
          <select
            aria-label="Condition value"
            className={cn(selectField, 'h-7 flex-1 text-xs')}
            value={clause.value}
            onChange={(e) => onChange({ ...clause, value: e.target.value })}
          >
            <option value="">choose…</option>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ) : (
          <input
            aria-label="Condition value"
            type={['priority', 'points', 'progress'].includes(field.key) ? 'number' : 'text'}
            className={cn(fieldStyle, 'h-7 flex-1 text-xs tabular-nums')}
            value={clause.value}
            onChange={(e) => onChange({ ...clause, value: e.target.value })}
          />
        ))}
      {!needsValue && <span className="flex-1" />}

      <IconButton icon={<Trash2 size={14} />} label="Remove this condition" onClick={onRemove} />
    </div>
  );
}

/**
 * A rule's trigger as one select value.
 *
 * Two of the six triggers carry a variant (which status, due today or overdue)
 * and four carry nothing. Joining them into one key is what lets this be a
 * single select rather than a select plus a conditional second select — the
 * reader is making one choice, and the control should be one control.
 */
function triggerKey(rule: AutomationRow): string {
  if (rule.trigger_kind === 'status') return `status:${rule.trigger_value ?? 'done'}`;
  if (rule.trigger_kind === 'due') return `due:${rule.trigger_value ?? 'overdue'}`;
  return `${rule.trigger_kind}:`;
}

function RuleCard({ rule, kinds, sprints, users, onSave, onDelete }: {
  rule: AutomationRow;
  kinds: TaskKindRow[];
  sprints: SprintRow[];
  users: UserRow[];
  onSave: (b: Partial<AutomationRow> & { actions?: AutomationAction[]; condition?: FilterClause[]; value?: string | null }) => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [adding, setAdding] = useState(false);

  const setActions = (actions: AutomationAction[]) => onSave({ actions });
  const setCondition = (condition: FilterClause[]) => onSave({ condition });
  const condition = rule.condition ?? [];

  return (
    <div className={cn('rounded-lg bg-surface p-3 ring-1 ring-inset ring-line', !rule.active && 'opacity-60')}>
      <div className="flex items-center gap-2">
        <input
          aria-label="Rule name"
          defaultValue={rule.name}
          placeholder="Name this rule"
          // Commit on blur rather than per keystroke: one rule is one PATCH.
          onBlur={(e) => e.target.value !== rule.name && onSave({ name: e.target.value })}
          className={cn(fieldStyle, 'h-7 flex-1 text-xs font-medium')}
        />
        <Switch on={rule.active} label={`${rule.name || 'Rule'} enabled`} onChange={(v) => onSave({ active: v })} />
      </div>

      <div className="mt-2.5 flex items-center gap-1.5">
        <span className="w-[104px] shrink-0 text-right text-xs text-muted">when</span>
        <select
          aria-label="Trigger"
          className={cn(selectField, 'h-7 flex-1 text-xs')}
          // One key for both halves of a trigger, because a select has one
          // value and "status becomes Done" is one choice, not two.
          value={triggerKey(rule)}
          onChange={(e) => {
            const [kind, value] = e.target.value.split(':');
            onSave({ trigger_kind: kind as AutomationTrigger, value: value || null });
          }}
        >
          {STATUSES.map((s) => (
            <option key={s} value={`status:${s}`}>status becomes {STATUS_LABEL[s]}</option>
          ))}
          <option value="created:">a task is created</option>
          <option value="assigned:">someone is assigned</option>
          <option value="due:today">it is due today</option>
          <option value="due:overdue">it is overdue</option>
          <option value="stale:">nothing has changed in</option>
          <option value="manual:">run by hand, from a task</option>
        </select>
        {/* Only `stale` has a number to carry, so only `stale` shows the box. */}
        {rule.trigger_kind === 'stale' && (
          <span className="flex shrink-0 items-center gap-1.5">
            <input
              type="number"
              min={1}
              max={365}
              aria-label="Days without a change"
              defaultValue={Number(rule.trigger_value) || 7}
              onBlur={(e) => onSave({ trigger_kind: 'stale', value: e.target.value })}
              className={cn(fieldStyle, 'h-7 w-[64px] text-xs tabular-nums')}
            />
            <span className="text-xs text-muted">days</span>
          </span>
        )}
      </div>
      {/* Said once, beside the two triggers it is true of: a rule a clock sets
          off has to stop somewhere, and "once per task" is the rule. */}
      {(rule.trigger_kind === 'due' || rule.trigger_kind === 'stale') && (
        <p className="mt-1 pl-[112px] text-3xs leading-4 text-faint">
          Checked hourly, and runs once per task — not every hour it stays true.
        </p>
      )}

      <div className="mt-1.5 space-y-1.5">
        {condition.map((c, i) => (
          <ConditionRow
            key={c.id ?? i}
            clause={c}
            kinds={kinds}
            sprints={sprints}
            users={users}
            onChange={(next) => setCondition(condition.map((x, j) => (j === i ? next : x)))}
            onRemove={() => setCondition(condition.filter((_, j) => j !== i))}
          />
        ))}
        {rule.actions.map((a, i) => (
          <ActionRow
            key={`${a.type}-${i}`}
            action={a}
            kinds={kinds}
            sprints={sprints}
            users={users}
            onChange={(next) => setActions(rule.actions.map((x, j) => (j === i ? next : x)))}
            onRemove={() => setActions(rule.actions.filter((_, j) => j !== i))}
          />
        ))}
      </div>

      <div className="mt-2 flex items-center gap-2">
        {adding ? (
          <select
            autoFocus
            aria-label="Add an action"
            className={cn(selectField, 'h-7 w-[180px] text-xs')}
            defaultValue=""
            onBlur={() => setAdding(false)}
            onChange={(e) => {
              if (e.target.value) setActions([...rule.actions, blankAction(e.target.value as AutomationAction['type'], kinds)]);
              setAdding(false);
            }}
          >
            <option value="" disabled>Add an action…</option>
            {(Object.keys(ACTION_LABEL) as AutomationAction['type'][]).map((t) => (
              <option key={t} value={t}>{ACTION_LABEL[t]}</option>
            ))}
          </select>
        ) : (
          <>
            <Button size="sm" variant="ghost" leftIcon={<Plus size={14} />} onClick={() => setAdding(true)}>
              Action
            </Button>
            <Button
              size="sm"
              variant="ghost"
              leftIcon={<Filter size={14} />}
              onClick={() => setCondition([
                ...condition,
                { id: crypto.randomUUID(), field: 'kind', op: 'is', value: '' },
              ])}
            >
              Condition
            </Button>
          </>
        )}

        {confirming ? (
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => setConfirming(false)}
              className="rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors duration-120 hover:bg-selected hover:text-ink"
            >
              Cancel
            </button>
            <button
              onClick={onDelete}
              className="rounded-md bg-danger px-2 py-1 text-xs font-medium text-white transition-[filter] duration-120 hover:brightness-95"
            >
              Delete
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="ml-auto rounded-md px-2 py-1 text-xs text-danger-strong transition-colors duration-120 hover:bg-danger-soft"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Per-database automations. A rule triggered by a status is a rule; the same
 * rule triggered by nothing is a quick action, offered on every task in the
 * database — one table, because they are the same thing twice.
 */
export function AutomationsDialog({ open, onOpenChange, projectId, kinds, sprints, users }: Props) {
  const [rows, setRows] = useState<AutomationRow[] | null>(null);

  const load = () => tasksApi.automations(projectId).then(setRows).catch(() => setRows([]));
  useEffect(() => { if (open && projectId) load(); }, [open, projectId]);

  const save = async (id: string, b: Parameters<typeof tasksApi.patchAutomation>[1]) => {
    // Optimistic: every control here is a select or a blur-commit, so waiting
    // for the round trip would make each one feel like it did not take.
    setRows((prev) => prev?.map((r) => (r.id === id ? { ...r, ...b, trigger_value: 'value' in b ? (b.value ?? null) : r.trigger_value } : r)) ?? prev);
    await tasksApi.patchAutomation(id, b).catch(load);
  };

  return (
    // focusPanel: this dialog's first control is the close button, and Radix's
    // default lands focus there — which opens its "Close" tooltip over the
    // heading the moment the dialog appears. See Modal.
    <Modal open={open} onOpenChange={onOpenChange} title="Automations" width={520} className="max-h-[80vh]" focusPanel>
      <div className="scrollarea min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        <p className="pb-1 text-2xs leading-4 text-faint">
          Rules run on something a person did — a move, a new task, a handover — or on a
          date arriving. Never on each other, so two rules cannot loop. A rule set to
          “run by hand” does nothing on its own and shows up on a task as a button. Add
          conditions to narrow which tasks a rule may touch; with none, it applies to all
          of them.
        </p>

        {rows === null ? (
          <p className="py-6 text-center text-sm text-faint">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="flex flex-col items-center gap-2 py-8 text-center text-sm text-faint">
            <Zap size={20} className="opacity-60" />
            No automations yet.
          </p>
        ) : rows.map((r) => (
          <RuleCard
            key={r.id}
            rule={r}
            kinds={kinds}
            sprints={sprints}
            users={users}
            onSave={(b) => save(r.id, b as Parameters<typeof tasksApi.patchAutomation>[1])}
            onDelete={async () => { await tasksApi.deleteAutomation(r.id); load(); }}
          />
        ))}
      </div>

      <div className="border-t border-line p-2">
        <Button
          size="sm"
          variant="secondary"
          leftIcon={<Plus size={14} />}
          onClick={async () => {
            await tasksApi.createAutomation(projectId, {
              name: '',
              trigger: 'status',
              value: 'done',
              actions: [{ type: 'progress', value: 100 }],
            });
            load();
          }}
        >
          New rule
        </Button>
      </div>
    </Modal>
  );
}
