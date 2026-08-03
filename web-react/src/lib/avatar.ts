// Deterministic avatar (initials + color) from a real name/email — no fake
// member records, just a stable visual per person.
const COLORS = ['#2383e2', '#12b8a0', '#e8794b', '#b84be8', '#4b9be8', '#e84b7a', '#5b8def', '#e0a53b'];

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
