/* Hallmark · component: agent attribution mark · genre: modern-minimal
 * theme: project tokens (index.css)
 * pre-emit critique: P5 H5 E4 S5 R5 V4
 * states: default (person, typed — renders nothing) · agent · made-with-ai
 * contrast: pass (40) — measured against the surfaces it sits on
 */
import { Bot, Sparkles } from 'lucide-react';
import { cn } from '../../lib/cn';

export type ActorKind = 'person' | 'agent';

/**
 * Says an agent did this, not a person.
 *
 * An agent signs in with a personal access token, so every row it writes
 * carries a `users.id` exactly like a colleague's. On screen that made the two
 * indistinguishable: the activity feed, a page's byline and a task's
 * attribution all read the same either way. This is the difference, drawn.
 *
 * It renders NOTHING for a person. A mark on every human name would be noise
 * on the overwhelming majority of rows, and the useful signal is the exception
 * — the same reason a read receipt marks the unread one.
 *
 * An icon rather than the word "bot": it sits inline beside a name in running
 * text, where a second word competes with the name for the line. The title
 * carries the words for anyone who hovers, and aria-label for anyone who
 * doesn't see the icon at all.
 */
export function ActorMark({
  kind,
  via,
  name,
  className,
}: {
  kind?: ActorKind | string | null;
  /**
   * How the write was made. 'ai' means the copilot did it inside a person's
   * own session — so the account is a person and the hand was not. This is the
   * commoner case of the two: an agent is one account you mark once, Ask AI is
   * everyone, every day.
   */
  via?: 'human' | 'ai' | null;
  /** Used in the label, so a screen reader hears who as well as what. */
  name?: string;
  className?: string;
}) {
  const isAi = via === 'ai';
  const isAgent = kind === 'agent';
  if (!isAi && !isAgent) return null;

  // When both are true the write is the more specific fact: an agent account
  // driving the copilot still made this particular edit through Ask AI.
  const label = isAi
    ? name
      ? `${name} made this with Ask AI`
      : 'Made with Ask AI, not typed'
    : name
      ? `${name} is an agent`
      : 'An agent, not a person';

  return (
    <span
      title={label}
      aria-label={label}
      role="img"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-sm p-0.5 align-middle',
        'bg-accent-soft text-accent-strong',
        className,
      )}
    >
      {isAi ? <Sparkles size={12} aria-hidden /> : <Bot size={12} aria-hidden />}
    </span>
  );
}
