import type { Config } from 'tailwindcss';

/**
 * Semantic tokens live as CSS custom properties in index.css (light + .dark).
 * Tailwind maps names -> var() so `bg-surface`, `text-ink`, `border-line`
 * all follow the active theme. Opacity modifiers aren't used on these tokens,
 * so raw hex/rgb in the vars is fine.
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
        'accent-soft': 'var(--accent-soft)',
        danger: 'var(--danger)',
        overlay: 'var(--overlay)',
        comment: 'var(--comment)',
        'comment-mark': 'var(--comment-mark)',
        tooltip: 'var(--tooltip)',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['Fraunces Variable', 'Fraunces', 'Georgia', 'ui-serif', 'serif'],
        serif: ['Lyon-Text', 'Georgia', 'ui-serif', 'serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      // One scale, no arbitrary values. 10–15px carries the whole UI; 17px+ is
      // display type (greeting, auth title, settings section head).
      fontSize: {
        '3xs': ['10px', { lineHeight: '14px' }],
        '2xs': ['11px', { lineHeight: '16px' }],
        xs: ['12px', { lineHeight: '17px' }],
        sm: ['13px', { lineHeight: '19px' }],
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
