import { Users } from 'lucide-react';
import type { Page } from '../../lib/types';
import { useWorkspace } from '../../store/workspace';
import { IconPicker } from './IconPicker';
import { TaskLink } from './TaskLink';

/** Icon + metadata band above the BlockSuite content. Title is BlockSuite's own. */
export function PageHeader({ page, fullWidth }: { page: Page; fullWidth: boolean }) {
  const ws = useWorkspace();
  return (
    <div
      className={[
        'mx-auto w-full',
        fullWidth ? 'max-w-none px-[clamp(40px,7vw,120px)]' : 'max-w-[var(--reading-w)] px-6',
      ].join(' ')}
    >
      {/* The icon alone sits above the title, Notion-style. Tags and the rest of
          the metadata moved BELOW the title (see DocMetaBand): the first thing on
          a page has to be its name, not the controls for editing its tags. */}
      <div className="flex items-center gap-2 pt-6 text-2xs text-faint md:pt-8">
        <IconPicker icon={page.icon} onPick={(icon) => ws.setIcon(page.id, icon)} />
        {/* Above the title, where a breadcrumb goes: a page that belongs to a
            task should say so before it says anything else. */}
        <TaskLink docId={page.id} />
        {page.shared && (
          <span className="flex items-center gap-1 text-accent">
            <Users size={12} /> Shared
          </span>
        )}
      </div>

    </div>
  );
}
