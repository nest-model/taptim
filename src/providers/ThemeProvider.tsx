import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'taptim.theme';

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

const media = () => window.matchMedia('(prefers-color-scheme: dark)');

function apply(pref: ThemePref, animate: boolean) {
  const root = document.documentElement;
  const dark = pref === 'dark' || (pref === 'system' && media().matches);
  if (animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.classList.add('theme-transition');
    window.setTimeout(() => root.classList.remove('theme-transition'), 260);
  }
  root.classList.toggle('dark', dark);
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((m) => m.setAttribute('content', dark ? '#111411' : '#F7F8F5'));
}

const Ctx = createContext<{ pref: ThemePref; setPref: (p: ThemePref) => void }>({
  pref: 'system',
  setPref: () => undefined,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(readPref);

  useEffect(() => {
    apply(pref, false);
    if (pref !== 'system') return;
    const mq = media();
    const onChange = () => apply('system', true);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pref]);

  const setPref = useCallback((p: ThemePref) => {
    try {
      localStorage.setItem(KEY, p);
    } catch {
      /* private mode: choice lives for this session only */
    }
    apply(p, true);
    setPrefState(p);
  }, []);

  return <Ctx.Provider value={{ pref, setPref }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
