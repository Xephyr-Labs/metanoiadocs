import { avatarFor } from '../../lib/avatar';

/** Initials on the person's colour. */
export function Avatar({ name, size = 22 }: { name: string; size?: number }) {
  const a = avatarFor(name);
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: a.color, fontSize: size * 0.42 }}
    >
      {a.initials}
    </span>
  );
}
