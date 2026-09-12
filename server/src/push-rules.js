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
 * Where a notification should open. Tasks are the reason this is not simply
 * the doc id: an assignment names a task, whose page does not exist until
 * someone opens it, and a project has no address of its own — so those land on
 * the dashboard, which is one click from the board rather than on `/d/null`.
 */
export function linkFor({ docId } = {}) {
  return docId ? `/d/${docId}` : '/';
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
