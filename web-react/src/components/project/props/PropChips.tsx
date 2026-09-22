/* Hallmark · component: read-only property chips · genre: modern-minimal
 * theme: project tokens (index.css) + tag palette (lib/tagColors)
 * pre-emit critique: P5 H5 E4 S4 R5 V4
 * states: default · empty (renders nothing) · truncated · media thumb ·
 *         overflow (+n) · overdue due-date · type-suppressed · cover-suppressed
 * note: read-only — no hover/focus/active/disabled; the card owns those.
 * contrast: pass (40) — light ramp measured at 4.8-6.9:1, dark at 5.7-10.8:1
 */
import { Fragment } from 'react';
import { Paperclip } from 'lucide-react';
import { cn } from '../../../lib/cn';
import { swatch } from '../../../lib/tagColors';
import { selectedOptions } from '../../../lib/props';
import { isBuiltinProp, readBuiltin } from '../../../lib/builtinProps';
import { fileUrl, isImageFile, isVideoFile, type StoredFile } from '../../../lib/uploads';
import type { PropRow, TaskKindRow, TaskRow } from '../../../lib/tasksApi';
import type { UserRow } from '../../../lib/docsApi';
import { AssigneeStack, isOverdue, KindBadge, shortDate, showsKindBadge } from '../TaskBadges';
import { useKinds } from '../kinds';

/**
 * A task's properties as they appear ON a card — a calendar event, a board
 * card, a gallery tile, a gantt row.
 *
 * Read-only by design. The card is a summary you scan; editing happens in the
 * peek panel, where a control has room to be a control. Everything here is one
 * line tall so a card's height stays a function of how many properties are
 * shown, not of what happens to be in them.
 *
 * Nothing is rendered for an empty value: a card carrying four blank rows to
 * keep its neighbours' alignment is how a calendar turns into a spreadsheet.
 *
 * Built-in fields (status, assignees, dates, type…) arrive here as ordinary
 * PropRows with a `sys:` id — see lib/builtinProps. Their value comes off the
 * task's own column rather than its `props` bag, which is the only difference
 * between them and a property somebody defined.
 */
export function PropChips({
  task,
  props,
  users,
  skipFile,
  className,
}: {
  task: TaskRow;
  /** Already filtered and ordered by the view's visibility settings. */
  props: PropRow[];
  users?: UserRow[];
  /** A file the card is already showing full-width as its cover, so the chip
   *  row leaves it out instead of printing the same picture twice. */
  skipFile?: StoredFile | null;
  className?: string;
}) {
  // Read here rather than inside the type branch: chipFor is a plain
  // function, and whether the badge draws has to be known before the node is
  // built — see showsKindBadge.
  const kinds = useKinds();

  const chips = props
    .map((p) => ({
      prop: p,
      node: chipFor(p, isBuiltinProp(p.id) ? readBuiltin(task, p.id) : task.props?.[p.id], task, kinds, users, skipFile),
    }))
    .filter((c) => c.node !== null);

  if (!chips.length) return null;

  // No wrapper element per property: `display: contents` was hiding the group
  // from the accessibility tree in some engines, which took the property name
  // with it. Each chip carries its own title instead.
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {chips.map((c) => (
        <Fragment key={c.prop.id}>{c.node}</Fragment>
      ))}
    </div>
  );
}

/** One property's value, or null when there is nothing worth drawing. */
function chipFor(
  prop: PropRow,
  value: unknown,
  task: TaskRow,
  kinds: TaskKindRow[],
  users?: UserRow[],
  skipFile?: StoredFile | null,
) {
  // Everyone on the task, as the same overlapped faces the board footer drew
  // before assignees became a property. A list of names in chips would wrap a
  // three-person card onto three lines.
  if (prop.id === 'sys:assignees') {
    const people = (value ?? []) as TaskRow['assignees'];
    return people?.length ? <AssigneeStack people={people} /> : null;
  }

  // Focus areas are page tags — strings, with no option row to colour them by.
  if (prop.id === 'sys:tags') {
    const tags = Array.isArray(value) ? (value as string[]) : [];
    return tags.length ? (
      <>
        {tags.map((t) => (
          <Chip key={t} color="gray" title={`${prop.label}: ${t}`}>{t}</Chip>
        ))}
      </>
    ) : null;
  }

  // The type badge knows when to say nothing: a project with one type, or a
  // row typed plainly "task", has nothing to tell apart, and labelling every
  // card "Task" is noise on all of them. It is drawn by the same badge the
  // backlog and the peek use, so that rule lives in one place — but asked
  // *first*, because a <KindBadge /> that renders null is still a node, and
  // the caller counts nodes to decide whether to draw the row at all.
  if (prop.id === 'sys:kind') {
    if (typeof value !== 'string' || !value) return null;
    return showsKindBadge(value, kinds) ? <KindBadge kind={value} /> : null;
  }

  // A bare "65" beside a bare "8" says neither which is which; the unit does.
  if (prop.id === 'sys:progress') {
    return typeof value === 'number'
      ? <Chip color="gray" title={`${prop.label}: ${value}%`}>{value}%</Chip>
      : null;
  }

  // A relation's value is not in the props bag — the ids live in their own
  // column, keyed by property, because a rollup has to reduce them without a
  // request per row. Without this branch the value fell through to the string
  // default and every relation drew nothing at all, on every card.
  //
  // A count, not the titles: the rows linked to are usually in another
  // database, so this card holds their ids and nothing else. Naming them would
  // mean a request per card to say what the peek already says on one click.
  if (prop.type === 'relation') {
    const linked = task.relationIds?.[prop.id]?.length ?? 0;
    return linked ? (
      <Chip color="gray" title={`${prop.label}: ${linked} linked ${linked === 1 ? 'row' : 'rows'}`}>
        {prop.label} · {linked}
      </Chip>
    ) : null;
  }

  switch (prop.type) {
    case 'select':
    case 'multi_select': {
      const chosen = selectedOptions(prop, value);
      if (!chosen.length) return null;
      return (
        <>
          {chosen.map((o) => (
            <Chip key={o.id} color={o.color} dot={prop.type === 'select'} title={`${prop.label}: ${o.label}`}>
              {o.label}
            </Chip>
          ))}
        </>
      );
    }
    case 'checkbox':
      // Only a ticked box says anything; an unticked one is the default state
      // of every task that never touched the property.
      return value ? <Chip color="green" title={prop.label}>✓ {prop.label}</Chip> : null;
    case 'person': {
      const u = users?.find((x) => x.id === value);
      return u ? <Chip color="blue" title={`${prop.label}: ${u.name || u.username}`}>{u.name || u.username}</Chip> : null;
    }
    case 'number':
      return typeof value === 'number' ? <Chip color="gray" title={`${prop.label}: ${value}`}>{value}</Chip> : null;
    case 'date': {
      if (typeof value !== 'string' || !value) return null;
      // A due date that has passed is red, as it was when the card drew its
      // own footer — losing that was the one thing on a board card anybody
      // actually scans for. Only the *due* date: a start date in the past is
      // just a task that has started.
      const late = prop.id === 'sys:due' && isOverdue(task);
      return (
        // "Sep 14", the way every other date in the app is written — an ISO
        // string on a card next to a board that says "Sep 14" reads as a
        // different kind of value rather than the same one.
        <Chip
          color={late ? 'red' : 'gray'}
          title={`${prop.label}: ${value.slice(0, 10)}${late ? ' — overdue' : ''}`}
        >
          {shortDate(value)}
        </Chip>
      );
    }
    case 'url':
      return typeof value === 'string' && value ? (
        <Chip color="blue" title={`${prop.label}: ${value}`}>{value.replace(/^https?:\/\//i, '').slice(0, 28)}</Chip>
      ) : null;
    case 'file': {
      const files = Array.isArray(value) ? (value as StoredFile[]) : [];
      const rest = skipFile ? files.filter((f) => f.key !== skipFile.key) : files;
      // null, not an empty <Media>: every other branch reports "nothing to
      // draw" by returning null, and the caller counts nodes to decide
      // whether to render the row at all. A <Media> that renders nothing is
      // still a node, so a card with no chips got the row and its margin
      // anyway — visible as dead space the moment Files & media joined the
      // board default.
      return rest.length ? <Media files={rest} /> : null;
    }
    default:
      return typeof value === 'string' && value.trim() ? (
        <span title={`${prop.label}: ${value}`} className="max-w-full truncate text-2xs text-muted">{value}</span>
      ) : null;
  }
}

function Chip({ color, dot, title, children }: { color: string; dot?: boolean; title?: string; children: React.ReactNode }) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex max-w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-2xs',
        swatch(color).chip,
      )}
    >
      {dot && <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', swatch(color).dot)} />}
      <span className="truncate">{children}</span>
    </span>
  );
}

/**
 * Files on a card: images and video posters show themselves, everything else
 * is a count. A card is too small to play anything, so a video renders its own
 * first frame via `preload="metadata"` rather than pulling the whole file.
 */
function Media({ files }: { files: StoredFile[] }) {
  if (!files.length) return null;
  const shown = files.slice(0, 3);
  const rest = files.length - shown.length;
  return (
    <>
      {shown.map((f) =>
        isImageFile(f) ? (
          <img
            key={f.key}
            src={fileUrl(f)}
            alt={f.name}
            loading="lazy"
            className="h-6 w-6 shrink-0 rounded border border-line object-cover"
          />
        ) : isVideoFile(f) ? (
          <video
            key={f.key}
            src={fileUrl(f)}
            preload="metadata"
            muted
            playsInline
            className="h-6 w-8 shrink-0 rounded border border-line bg-surface object-cover"
          />
        ) : (
          <span
            key={f.key}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-line bg-surface text-faint"
          >
            <Paperclip size={12} />
          </span>
        ),
      )}
      {rest > 0 && <span className="text-2xs text-faint">+{rest}</span>}
    </>
  );
}
