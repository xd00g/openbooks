/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: 'var(--ob-paper)',
        ink: 'var(--ob-ink)',
        rule: 'var(--ob-rule)',
        muted: 'var(--ob-muted)',
        // Semantic money state. These are the only hues in the interface —
        // chrome is paper/ink/rule only, so color always means a ledger fact.
        balance: 'var(--ob-balance)',
        owed: 'var(--ob-owed)',
        sidebar: 'var(--ob-sidebar-bg)',
        'sidebar-text': 'var(--ob-sidebar-text)',
        accent: 'var(--ob-accent)',
        'accent-text': 'var(--ob-accent-text)',
      },
      fontFamily: {
        display: ['"Archivo Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['"Inter Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        eyebrow: ['0.6875rem', { lineHeight: '1', letterSpacing: '0.12em' }],
        figure: ['1.75rem', { lineHeight: '1.05', letterSpacing: '-0.02em' }],
        title: ['1.5rem', { lineHeight: '1.1', letterSpacing: '-0.01em' }],
      },
      borderRadius: {
        // A ledger has no rounded corners. 2px is the whole vocabulary.
        DEFAULT: '2px',
        sm: '2px',
        md: '2px',
        lg: '2px',
        xl: '2px',
      },
      borderColor: {
        DEFAULT: 'var(--ob-rule)',
      },
    },
  },
  plugins: [],
};
