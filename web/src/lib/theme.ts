/**
 * Per-company branding. The stored `theme` is a small palette; we project it
 * onto CSS custom properties on :root so the app chrome (sidebar, primary
 * buttons/links) restyles instantly. Defaults reproduce the stock slate look,
 * so a company with no theme is unchanged.
 */
export interface Theme {
  sidebarBg?: string;
  sidebarText?: string;
  accent?: string;
  accentText?: string;
}

export const DEFAULT_THEME: Required<Theme> = {
  sidebarBg: '#0f172a', // slate-900
  sidebarText: '#e2e8f0', // slate-200
  accent: '#0f172a',
  accentText: '#ffffff',
};

export const THEME_FIELDS: { key: keyof Theme; label: string }[] = [
  { key: 'sidebarBg', label: 'Sidebar background' },
  { key: 'sidebarText', label: 'Sidebar text' },
  { key: 'accent', label: 'Accent (buttons & links)' },
  { key: 'accentText', label: 'Accent text' },
];

export function applyTheme(theme?: Theme | null) {
  const t = { ...DEFAULT_THEME, ...(theme ?? {}) };
  const r = document.documentElement.style;
  r.setProperty('--ob-sidebar-bg', t.sidebarBg);
  r.setProperty('--ob-sidebar-text', t.sidebarText);
  r.setProperty('--ob-accent', t.accent);
  r.setProperty('--ob-accent-text', t.accentText);
}
