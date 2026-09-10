import { useEffect, useState } from 'react';
import { CheckSquare } from 'lucide-react';
import { STATUS_LABEL, tasksApi, type DocTask } from '../../lib/tasksApi';
import { useWorkspace } from '../../store/workspace';

/**
 * The way back from a page to the task it belongs to.
 *
 * A task's page and the task itself are one thing seen twice — the same title,
 * the same content — but until this chip existed the trip was one-way: a task
 * could open its page, and a page could not name the board it came from.
 *
 * Renders nothing for the great majority of pages, which belong to no task.
 */
export function TaskLink({ docId }: { docId: string }) {
  const ws = useWorkspace();
  const [task, setTask] = useState<DocTask | null>(null);

  useEffect(() => {
    let alive = true;
    setTask(null);
    tasksApi.docTask(docId).then((r) => alive && setTask(r.task)).catch(() => {});
    return () => { alive = false; };
  }, [docId]);

  if (!task) return null;
  const isRow = task.project_mode === 'data';

  return (
    <button
      type="button"
      onClick={() => ws.openProject(task.project_id, task.id)}
      className="flex max-w-full items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-2xs text-muted transition-colors hover:border-accent hover:text-ink"
      title={`Open this ${isRow ? 'row' : 'task'} in ${task.project_name}`}
    >
      <CheckSquare size={12} className="shrink-0 text-faint" />
      <span aria-hidden>{task.project_icon}</span>
      <span className="truncate">{task.project_name}</span>
      {!isRow && (
        <>
          <span aria-hidden className="text-faint">·</span>
          <span className="shrink-0">{STATUS_LABEL[task.status]}</span>
        </>
      )}
    </button>
  );
}
