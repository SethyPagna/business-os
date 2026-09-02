import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Brass/gold accent replacing the old blue scale (Aug 24 2026 --
        // "clean, neat, professional, expensive" request; charcoal/graphite
        // neutrals + one warm brass accent, no blue). 600 matches
        // --ui-accent in styles/main.css so the two systems agree if a
        // component ever reaches for `primary-*` classes directly instead
        // of the CSS variable.
        primary: {
          50: '#fbf7ee', 100: '#f5ecd8', 200: '#e9d5a8',
          300: '#dcbe78', 400: '#c9a34e', 500: '#b3893a',
          600: '#9c7a3c', 700: '#7d5f2a', 800: '#5f481f', 900: '#423214',
        },
        // Design kit tokens (P2-1, frontend/src/styles/tokens.css). Backed
        // by CSS custom properties so `bg-ui-ground`/`text-ui-ink`/etc. stay
        // in sync with the light/dark palette and the user's live accent
        // color without a second source of truth.
        'ui-ground': 'var(--ui-ground)',
        'ui-surface': 'var(--ui-surface)',
        'ui-surface-2': 'var(--ui-surface-2)',
        'ui-ink': 'var(--ui-ink)',
        'ui-ink-2': 'var(--ui-ink-2)',
        'ui-ink-3': 'var(--ui-ink-3)',
        'ui-line': 'var(--ui-line)',
        'ui-line-2': 'var(--ui-line-2)',
        'ui-accent': 'var(--ui-accent)',
        'ui-accent-ink': 'var(--ui-accent-ink)',
        'ui-accent-soft': 'var(--ui-accent-soft)',
        'ui-danger': 'var(--ui-danger)',
        'ui-success': 'var(--ui-success)',
        'ui-warn': 'var(--ui-warn)',
        'ui-info': 'var(--ui-info)',
      },
      fontFamily: {
        'ui-body': 'var(--ui-font-body)',
        'ui-display': 'var(--ui-font-display)',
        'ui-khmer-body': 'var(--ui-font-khmer-body)',
        'ui-khmer-display': 'var(--ui-font-khmer-display)',
      },
      boxShadow: {
        'ui-1': 'var(--ui-shadow-1)',
        'ui-2': 'var(--ui-shadow-2)',
        'ui-3': 'var(--ui-shadow-3)',
      },
      borderRadius: {
        'ui-sm': 'var(--ui-radius-sm)',
        ui: 'var(--ui-radius)',
        'ui-lg': 'var(--ui-radius-lg)',
      },
    },
  },
  plugins: [],
} satisfies Config
