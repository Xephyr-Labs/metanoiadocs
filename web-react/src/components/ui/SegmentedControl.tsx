import * as Toggle from '@radix-ui/react-toggle-group';
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface Segment {
  value: string;
  label: string;
  icon?: ReactNode;
}

interface Props {
  segments: Segment[];
  value: string;
  onChange: (v: string) => void;
  'aria-label': string;
}

/** Compact segmented control with a sliding pill (Page / Edgeless). */
export function SegmentedControl({ segments, value, onChange, ...aria }: Props) {
  return (
    <Toggle.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onChange(v)}
      aria-label={aria['aria-label']}
      className="inline-flex items-center gap-0.5 rounded-md bg-surface p-0.5 ring-1 ring-inset ring-line"
    >
      {segments.map((s) => {
        const active = s.value === value;
        return (
          <Toggle.Item
            key={s.value}
            value={s.value}
            className={cn(
              'relative inline-flex h-6 items-center gap-1 rounded px-2 text-sm font-medium transition-colors duration-120',
              active ? 'text-ink' : 'text-muted hover:text-ink',
            )}
          >
            {active && (
              <motion.span
                layoutId="segmented-pill"
                className="absolute inset-0 rounded bg-canvas shadow-subtle"
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              />
            )}
            <span className="relative flex items-center gap-1">
              {s.icon}
              {/* A hook, not a breakpoint: the editor bar hides the word when
                  its own column is narrow, whatever the window is doing. */}
              <span className="mn-seg-label">{s.label}</span>
            </span>
          </Toggle.Item>
        );
      })}
    </Toggle.Root>
  );
}
