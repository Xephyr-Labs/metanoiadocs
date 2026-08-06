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
                transition={{ type: 'spring', stiffness: 500, damping: 40 }}
              />
            )}
            <span className="relative flex items-center gap-1">
              {s.icon}
              {s.label}
            </span>
          </Toggle.Item>
        );
      })}
    </Toggle.Root>
  );
}
