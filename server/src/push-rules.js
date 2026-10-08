/**
 * The decisions Web Push needs, kept away from the library that talks to the
 * push services — the same split mentions.js and project-tree.js use, so these
 * can be tested without a network, a database or a VAPID pair.
 */

/**
 * A subscription the push service has disowned. 404 is "never heard of it",
 * 410 is "gone" — both mean the row is dead and keeping it only buys a failed
 * request per notification forever. Every other code is the service having a
 * bad day, and throwing the subscription away over one would silence a device
 * permanently for a problem that lasts a minute.
 */
export const isGone = (statusCode) => statusCode === 404 || statusCode === 410;

/**
 * Where a notification should open. A task comes first: its panel over the
 * database is the task's own screen — fields, thread and page together — and
 * it exists whether or not the page has been made, so an alert about a task
 * lands on that task, not on a board with forty cards or on its bare page.
 * Then the page, then the database alone, and the dashboard as the last
 * resort, for a notification about nothing addressable (never `/d/null`).
 */
export function linkFor({ docId, projectId, taskId } = {}) {
  if (taskId && projectId) return `/db/${projectId}?task=${encodeURIComponent(taskId)}`;
  if (docId) return `/d/${docId}`;
  return projectId ? `/db/${projectId}` : '/';
}

/**
 * The push service behind an endpoint, which is all anyone should ever be
 * shown: the rest of the URL is a capability, and whoever holds it can push to
 * that device.
 */
export function hostOf(endpoint) {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'unknown';
  }
}
