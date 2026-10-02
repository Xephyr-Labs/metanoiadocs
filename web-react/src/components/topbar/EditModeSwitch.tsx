import { ChevronDown, Eye, GitPullRequestArrow, PencilLine, SquarePen } from 'lucide-react';
import type { Page } from '../../lib/types';
import { openReview, useReviewState, type EditMode } from '../../lib/reviewMode';
import { useAuth } from '../../store/auth';
import { Menu } from '../ui/Menu';

const META: Record<EditMode, { label: string; hint: string; icon: typeof PencilLine }> = {
  editing: { label: 'Editing', hint: 'Edit the page directly', icon: PencilLine },
  suggesting: { label: 'Suggesting', hint: 'Edits become suggestions for review', icon: SquarePen },
  viewing: { label: 'Viewing', hint: 'Read or comment, no edits', icon: Eye },
};

/**
 * The Editing / Suggesting / Viewing switch, and — for anyone who can edit the
 * page — a "Review" button when someone has submitted suggested changes.
 */
export function EditModeSwitch({ page }: { page: Page }) {
  const auth = useAuth();
  const review = useReviewState(page.id, page.role, auth.user?.id);
  const current = META[review.mode];
  const Icon = current.icon;
  const others = review.toReview;

  return (
    <>
      {others.length > 0 && (
        <Menu
          align="end"
          width={300}
          items={others.map((d) => ({
            icon: GitPullRequestArrow,
            label: `Review ${d.authorName}'s changes`,
            onSelect: () => openReview(d.id, page.id),
          }))}
          trigger={
            <button
              type="button"
              className="flex h-7 items-center gap-1.5 rounded-md bg-accent-soft px-2 text-xs font-medium text-accent-strong transition-colors hover:opacity-90"
              aria-label={`${others.length} suggested change set${others.length === 1 ? '' : 's'} to review`}
            >
              <GitPullRequestArrow size={14} />
              <span className="hidden sm:inline">Review</span>
              <span className="tabular-nums">{others.length}</span>
            </button>
          }
        />
      )}
      {review.allowed.length > 1 ? (
        <Menu
          align="end"
          width={260}
          items={review.allowed.map((m) => ({
            icon: META[m].icon,
            label: `${META[m].label} — ${META[m].hint}`,
            checked: m === review.mode,
            onSelect: () => review.setMode(m),
          }))}
          trigger={
            <button
              type="button"
              aria-label={`Mode: ${current.label}`}
              className="flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted transition-colors hover:bg-hover"
            >
              <Icon size={14} className={review.mode === 'suggesting' ? 'text-accent' : undefined} />
              <span className="hidden md:inline">{current.label}</span>
              <ChevronDown size={14} className="hidden text-faint sm:block" />
            </button>
          }
        />
      ) : (
        <span className="flex h-7 items-center gap-1.5 px-2 text-sm text-faint" title="You can view this page">
          <Eye size={14} />
          <span className="hidden md:inline">Viewing</span>
        </span>
      )}
    </>
  );
}
