import { Users } from 'lucide-react';
import type { Page } from '../../lib/types';
import type { Intelligence } from '../../lib/docsApi';
import { relativeTime } from '../../lib/time';
import { DocIcon } from '../ui/DocIcon';
import { TagChips } from './TagChips';
import { TagSuggestions } from './TagSuggestions';

/** Icon + metadata band above the BlockSuite content. Title is BlockSuite's own. */
export function PageHeader({ page, fullWidth, suggested }: { page: Page; fullWidth: boolean; suggested: Intelligence['suggestedTags'] }) {
  return (
    <div
      className={[
        'mx-auto w-full',
        fullWidth ? 'max-w-none px-[clamp(40px,7vw,120px)]' : 'max-w-[var(--reading-w)] px-6',
      ].join(' ')}
    >
      <div className="pt-14">
        <div className="flex h-[56px] w-[56px] items-center justify-center text-faint">
          <DocIcon hasChildren={page.children.length > 0} size={44} className="" />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3 text-2xs text-faint">
        <span>Edited {relativeTime(page.updatedAt)}</span>
        {page.shared && (
          <span className="flex items-center gap-1 text-accent">
            <Users size={12} /> Shared
          </span>
        )}
      </div>

      <TagChips page={page} />
      <TagSuggestions pageId={page.id} suggested={suggested} />
    </div>
  );
}
