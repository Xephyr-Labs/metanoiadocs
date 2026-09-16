// The prompt a run becomes.
//
// Its own module so it can be checked without starting a polling loop — and so
// the shape of what an agent is told is one readable thing rather than string
// concatenation buried in the middle of a daemon.
/**
 * What the CLI is actually asked to do.
 *
 * The task's own fields come first as a short header, then the page it is
 * written on, then the ask — a coding agent reads top-down and the ask is what
 * it should still have in mind when it starts working.
 */
export function buildPrompt(run) {
  const parts = [];
  if (run.task) {
    const t = run.task;
    parts.push(
      `# ${t.title || 'Untitled task'}`,
      '',
      `- Database: ${t.project_name}`,
      `- Status: ${t.status}${t.kind ? ` · Type: ${t.kind}` : ''}`,
      ...(t.due_at ? [`- Due: ${String(t.due_at).slice(0, 10)}`] : []),
      ''
    );
  }
  if (run.page?.text?.trim()) {
    parts.push('## The page', '', run.page.text.trim(), '');
  }
  const ask = run.trigger === 'mention'
    ? `You were @-mentioned${run.requestedBy?.name ? ` by ${run.requestedBy.name}` : ''}:\n\n> ${run.prompt}`
    : run.task
      ? 'This task has been assigned to you. Do it, then say what you did.'
      : run.prompt;
  parts.push('## What to do', '', ask, '',
    'Reply with what you did, in Markdown. It is posted as a comment on the page.');
  return parts.join('\n');
}
