import { describe, expect, it } from 'vitest';
import { Bookmark, Bug, CircleDot, Layers, SquareCheck, Zap } from 'lucide-react';
import { kindIcon, kindVisual } from '../../lib/taskKinds';
import { swatch, TAG_COLORS } from '../../lib/tagColors';
import type { TaskKindRow } from '../../lib/tasksApi';

const kind = (key: string, label = key, extra: Partial<TaskKindRow> = {}): TaskKindRow => ({
  id: key, project_id: 'p', key, label, color: 'gray', is_group: false, position: 0, ...extra,
});

describe('kindIcon', () => {
  it('gives the four seeded types their own glyphs', () => {
    expect(kindIcon('epic')).toBe(Zap);
    expect(kindIcon('story')).toBe(Bookmark);
    expect(kindIcon('task')).toBe(SquareCheck);
    expect(kindIcon('bug')).toBe(Bug);
  });

  it('says only "holds children" or not about a type somebody added', () => {
    expect(kindIcon('initiative', true)).toBe(Layers);
    expect(kindIcon('spike', false)).toBe(CircleDot);
  });
});

describe('kindVisual', () => {
  it('draws plain Task like any other type, so no type is told by absence', () => {
    // The old rule hid the default type; every row now carries a glyph.
    const v = kindVisual('task', [kind('task', 'Task'), kind('bug', 'Bug')]);
    expect(v).toMatchObject({ icon: SquareCheck, label: 'Task', missing: false });
  });

  it('takes the colour and label from the project, not the seed', () => {
    const v = kindVisual('story', [kind('story', 'User story', { color: 'teal' })]);
    expect(v).toMatchObject({ icon: Bookmark, color: 'teal', label: 'User story' });
  });

  it('marks a renamed custom container with the container glyph', () => {
    expect(kindVisual('theme', [kind('theme', 'Theme', { is_group: true })]).icon).toBe(Layers);
  });

  it('falls back to the seeded look when no type list is at hand', () => {
    // The cross-project task list knows keys only.
    expect(kindVisual('story', [])).toMatchObject({ icon: Bookmark, color: 'green', label: 'Story', missing: false });
    expect(kindVisual('bug', [])).toMatchObject({ color: 'red' });
  });

  it('draws a type deleted elsewhere in neutral grey, still named', () => {
    const v = kindVisual('gone', [kind('task', 'Task')]);
    expect(v).toMatchObject({ icon: CircleDot, color: 'gray', label: 'Gone', missing: true });
  });
});

describe('swatch().icon', () => {
  it('exists for every palette colour and puts a contrasting glyph on the fill', () => {
    for (const c of TAG_COLORS) {
      expect(swatch(c).icon).toMatch(/text-white dark:text-canvas/);
    }
  });
});
