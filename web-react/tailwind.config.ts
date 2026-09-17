import type { Config } from 'tailwindcss';

/**
 * Semantic tokens live as CSS custom properties in index.css (light + .dark).
 * Tailwind maps names -> var() so `bg-surface`, `text-ink`, `border-line`
 * all follow the active theme. Opacity modifiers CANNOT be used on them:
 * Tailwind can't split a var() into channels, so `bg-danger/10` emits no CSS
 * at all — the class silently does nothing. Use a solid token (`bg-danger-soft`)
 * or add a color-mix() token in index.css (`--tint`, `--glass`).
 */
export default {
  // `html.dark`, not a bare `.dark`: BlockSuite writes its theme name as a class
  // on block wrappers inside the editor, and a bare selector would let those
  // turn on dark variants mid-page.
  darkMode: ['class', 'html.dark'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--canvas)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        hover: 'var(--hover)',
        selected: 'var(--selected)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        faint: 'var(--faint)',
        line: 'var(--line)',
        'line-strong': 'var(--line-strong)',
        accent: 'var(--accent)',
        'accent-strong': 'var(--accent-strong)',
        'accent-soft': 'var(--accent-soft)',
        'accent-fill': 'var(--accent-fill)',
        'danger-soft': 'var(--danger-soft)',
        danger: 'var(--danger)',
        'danger-strong': 'var(--danger-strong)',
        ok: 'var(--ok)',
        overlay: 'var(--overlay)',
        glass: 'var(--glass)',
        comment: 'var(--comment)',
        'comment-mark': 'var(--comment-mark)',
        tooltip: 'var(--tooltip)',
      },
      fontFamily: {
        sans: ['Onest Variable', 'Onest', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        // Display is the same face, carried by weight and tracking rather than
        // by a second family — see --font-display in index.css.
        display: ['Onest Variable', 'Onest', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        serif: ['Lyon-Text', 'Georgia', 'ui-serif', 'serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      // One scale, no arbitrary values. 10–15px carries the whole UI; 17px+ is
      // display type (greeting, auth title, settings section head).
      fontSize: {
        // The bottom four rungs each moved up a step: the chrome was set a size
        // below what it needed and read cramped and washed-out next to the
        // document. Moving the rungs rather than rewriting ~40 call sites keeps
        // one scale — `sm` and `base` now coincide at 14px, which is deliberate:
        // 14 is the floor for a row a person reads all day, and nothing in the
        // chrome should sit under it.
        '3xs': ['11px', { lineHeight: '15px' }],
        '2xs': ['12px', { lineHeight: '16px' }],
        xs: ['13px', { lineHeight: '18px' }],
        sm: ['14px', { lineHeight: '20px' }],
        base: ['14px', { lineHeight: '20px' }],
        md: ['15px', { lineHeight: '22px' }],
        lg: ['17px', { lineHeight: '24px' }],
        xl: ['20px', { lineHeight: '26px' }],
        '2xl': ['22px', { lineHeight: '28px' }],
        '3xl': ['26px', { lineHeight: '32px' }],
        '4xl': ['28px', { lineHeight: '36px' }],
      },
      borderRadius: {
        sm: '4px',
        DEFAULT: '6px',
        md: '6px',
        lg: '8px',
        xl: '12px',
      },
      boxShadow: {
        // Notion/Linear-grade: hairline + soft, never heavy.
        subtle: '0 1px 2px rgba(15,15,15,0.04), 0 0 0 1px var(--line)',
        pop: '0 2px 4px rgba(15,15,15,0.04), 0 8px 24px rgba(15,15,15,0.10), 0 0 0 1px var(--line)',
        modal: '0 8px 40px rgba(15,15,15,0.16), 0 0 0 1px var(--line)',
        panel: '-1px 0 0 var(--line)',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      transitionDuration: {
        120: '120ms',
        180: '180ms',
        220: '220ms',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 120ms cubic-bezier(0.16,1,0.3,1)',
        'scale-in': 'scale-in 160ms cubic-bezier(0.16,1,0.3,1)',
        'slide-up': 'slide-up 180ms cubic-bezier(0.16,1,0.3,1)',
      },
    },
  },
  plugins: [],
} satisfies Config;
