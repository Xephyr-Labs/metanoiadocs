/** Whether a write to an existing page lands directly or becomes a suggestion. */
export function writePolicy({ user, via, token }) {
  if (via === 'ai') return 'suggest'; // Ask AI is never trusted
  if (user?.kind === 'agent') return token?.trusted ? 'direct' : 'suggest';
  return 'direct';
}
