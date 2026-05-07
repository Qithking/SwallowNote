import { writable } from 'svelte/store';

export type Theme = 'dark' | 'light';

function getSystemTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function createThemeStore() {
  const { subscribe, set } = writable<Theme>(getSystemTheme());

  return {
    subscribe,
    init() {
      const theme = getSystemTheme();
      document.documentElement.setAttribute('data-theme', theme);
      set(theme);

      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = (e: MediaQueryListEvent) => {
        const newTheme = e.matches ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', newTheme);
        set(newTheme);
      };
      mediaQuery.addEventListener('change', handler);

      return () => mediaQuery.removeEventListener('change', handler);
    },
  };
}

export const theme = createThemeStore();
