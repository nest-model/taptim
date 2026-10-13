import type { Dictionary } from './ru';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends string ? string : DeepPartial<T[K]> };

// Kazakh: partial translation scaffold. Untranslated keys fall back to Russian automatically.
// Translations must be reviewed by a native speaker before enabling the language in production.
export const kk: DeepPartial<Dictionary> = {
  common: {
    loading: 'Жүктелуде…',
    retry: 'Қайталау',
    cancel: 'Бас тарту',
    close: 'Жабу',
    save: 'Сақтау',
    delete: 'Жою',
    back: 'Артқа',
    next: 'Әрі қарай',
    search: 'Іздеу',
    login: 'Кіру',
    logout: 'Шығу',
  },
  nav: {
    home: 'Басты бет',
    search: 'Іздеу',
    create: 'Жариялау',
    chats: 'Хабарламалар',
    profile: 'Профиль',
    favorites: 'Таңдаулылар',
    settings: 'Баптаулар',
  },
};
