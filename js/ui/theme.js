// Тема оформления: светлая, тёмная, как в системе.
import { $ } from '../dom.js';
import { app } from './context.js';

const THEME_COLORS = { light: '#f4f2ed', dark: '#0d0e11' };

export const THEME_NAMES = { auto: 'как в системе', light: 'светлая', dark: 'тёмная' };

function resolvedTheme() {
  if (app.prefs.theme !== 'auto') return app.prefs.theme;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme() {
  const t = resolvedTheme();
  document.documentElement.dataset.theme = t;
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.content = THEME_COLORS[t];
  $('theme').value = app.prefs.theme;
  const btn = $('themeBtn');
  btn.dataset.mode = app.prefs.theme;
  btn.setAttribute('aria-label', `Тема: ${THEME_NAMES[app.prefs.theme]}. Нажми, чтобы сменить`);
  btn.title = `Тема: ${THEME_NAMES[app.prefs.theme]}`;
}
