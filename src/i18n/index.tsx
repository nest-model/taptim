import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { kk } from './kk';
import { ru, type Dictionary } from './ru';

export type Lang = 'ru' | 'kk';
// Kazakh is scaffolded but disabled until the translation is complete and reviewed.
export const ENABLED_LANGS: Lang[] = ['ru'];
const KEY = 'taptim.lang';

function merge<T>(base: T, over: unknown): T {
  if (!over || typeof over !== 'object') return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    const b = (base as Record<string, unknown>)[k];
    out[k] = b && typeof b === 'object' ? merge(b, v) : (v ?? b);
  }
  return out as T;
}

const DICTS: Record<Lang, Dictionary> = { ru, kk: merge<Dictionary>(ru, kk) };

let current: Lang = 'ru';
/** For non-React code (error mapping in mutations). */
export const getDict = (): Dictionary => DICTS[current];
export const getLang = (): Lang => current;

function initialLang(): Lang {
  try {
    const v = localStorage.getItem(KEY) as Lang | null;
    if (v && ENABLED_LANGS.includes(v)) return v;
  } catch {
    /* ignore */
  }
  return 'ru';
}

const Ctx = createContext<{ t: Dictionary; lang: Lang; setLang: (l: Lang) => void }>({
  t: ru,
  lang: 'ru',
  setLang: () => undefined,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    current = initialLang();
    return current;
  });
  const value = useMemo(
    () => ({
      t: DICTS[lang],
      lang,
      setLang: (l: Lang) => {
        current = l;
        document.documentElement.lang = l;
        try {
          localStorage.setItem(KEY, l);
        } catch {
          /* ignore */
        }
        setLangState(l);
      },
    }),
    [lang],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useT = () => useContext(Ctx).t;
export const useLang = () => useContext(Ctx);

/** Picks the localized name of a DB reference row (cities, districts, categories). */
export function localizedName(
  row: { name_ru: string; name_kk?: string | null } | null | undefined,
  lang: Lang = current,
) {
  if (!row) return '';
  return lang === 'kk' && row.name_kk ? row.name_kk : row.name_ru;
}
