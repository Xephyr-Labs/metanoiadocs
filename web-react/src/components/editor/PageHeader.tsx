import { Users } from 'lucide-react';
import type { Page } from '../../lib/types';
import type { Intelligence } from '../../lib/docsApi';
import { useWorkspace } from '../../store/workspace';
import { IconPicker } from './IconPicker';
import { TagChips } from './TagChips';
import { TagSuggestions } from './TagSuggestions';

/** Icon + metadata band above the BlockSuite content. Title is BlockSuite's own. */
export function PageHeader({ page, fullWidth, suggested }: { page: Page; fullWidth: boolean; suggested: Intelligence['suggestedTags'] }) {
  const ws = useWorkspace();
  return (
    <div
      className={[
        'mx-auto w-full',
        fullWidth ? 'max-w-none px-[clamp(40px,7vw,120px)]' : 'max-w-[var(--reading-w)] px-6',
      ].join(' ')}
    >
      {/* Icon + sharing state only. "Edited …" lives in the top bar, where it
          stays visible as you scroll; repeating it here was the same fact twice
          within 60px. */}
      <div className="flex items-center gap-2 pt-6 text-2xs text-faint md:pt-9">
        <IconPicker icon={page.icon} onPick={(icon) => ws.setIcon(page.id, icon)} />
        {page.shared && (
          <span className="flex items-center gap-1 text-accent">
            <Users size={12} /> Shared
          </span>
        )}
      </div>

      <TagChips page={page} trailing={<TagSuggestions pageId={page.id} suggested={suggested} />} />
    </div>
  );
}
