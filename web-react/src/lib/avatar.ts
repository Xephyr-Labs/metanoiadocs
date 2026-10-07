// Deterministic avatar (initials + color) from a real name/email — no fake
// member records, just a stable visual per person.
/** Every avatar letters its initials in white, so each hue is taken just deep
 * enough for white to read at 4.6:1 or better. The old set ran 2.2–4.0:1, and
 * the amber one made "RM" all but invisible. Eight distinct hues, same order,
 * so everyone keeps their colour family. */
const COLORS = ['#1b76d0', '#0d8372', '#c84d1a', '#b037e5', '#0e7490', '#e21e59', '#4f5bd5', '#9a6c18'];

export function avatarFor(nameOrEmail: string): { initials: string; color: string } {
  const s = (nameOrEmail || '?').trim();
  const parts = s.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  const initials = (
    parts.length >= 2 ? parts[0][0] + parts[1][0] : s.slice(0, 2)
  ).toUpperCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return { initials, color: COLORS[h % COLORS.length] };
}
