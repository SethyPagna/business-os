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
      },
    },
  },
  plugins: [],
} satisfies Config
