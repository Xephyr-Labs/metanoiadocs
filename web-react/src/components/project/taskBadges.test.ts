import { describe, expect, it } from 'vitest';
import { showsKindBadge } from './TaskBadges';
import type { TaskKindRow } from '../../lib/tasksApi';

const kind = (key: string, label = key): TaskKindRow => ({
  id: key, project_id: 'p', key, label, color: 'gray', is_group: false, position: 0,
});

describe('showsKindBadge', () => {
  it('says nothing before the project types have loaded', () => {
    // The common path on first paint. A badge here would either be wrong or
    // blank, and a blank one still counts as a chip to whoever is counting.
    expect(showsKindBadge('bug', [])).toBe(false);
  });

  it('says nothing for the unremarkable default type', () => {
    expect(showsKindBadge('task', [kind('task', 'Task'), kind('bug', 'Bug')])).toBe(false);
  });

  it('says nothing when the project has only one type to tell apart', () => {
    expect(showsKindBadge('bug', [kind('bug', 'Bug')])).toBe(false);
  });

  it('draws a real type that is not the default', () => {
    expect(showsKindBadge('bug', [kind('task', 'Task'), kind('bug', 'Bug')])).toBe(true);
  });

  it('draws a type that was deleted elsewhere, so the row does not look untyped', () => {
    // No matching row but the list HAS loaded: the badge prints the raw key.
    expect(showsKindBadge('gone', [kind('task', 'Task'), kind('bug', 'Bug')])).toBe(true);
  });
});
