import { describe, expect, it } from 'vitest';
import { Bookmark, CircleDot, Layers, Rocket, Zap } from 'lucide-react';
import { isFixedKind, kindIcon, kindVisual } from './taskKinds';

const row = (key: string, icon: string | null, is_group = false) => ({ key, label: key, color: 'blue', is_group, icon });

describe('kindIcon', () => {
  it('draws a custom type with the icon its creator picked', () => {
    expect(kindIcon('research', false, 'rocket')).toBe(Rocket);
    expect(kindVisual('research', [row('research', 'rocket')]).icon).toBe(Rocket);
  });

  it('keeps the four built-in glyphs whatever is stored', () => {
    expect(kindIcon('epic', true, 'rocket')).toBe(Zap);
    expect(kindVisual('story', [row('story', 'rocket')]).icon).toBe(Bookmark);
    expect(isFixedKind('bug')).toBe(true);
    expect(isFixedKind('research')).toBe(false);
  });

  it('falls back to the default for no icon or an unknown name', () => {
    expect(kindIcon('research', false, null)).toBe(CircleDot);
    expect(kindIcon('initiative', true, 'no-such-icon')).toBe(Layers);
  });
});
