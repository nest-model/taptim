import { createContext, useContext, useState, type ReactNode } from 'react';
import { DEFAULT_CITY } from '@/config/listing';
import { useAuth } from './AuthProvider';

const KEY = 'taptim.city';

// The selected city lives in ONE place. Components read it via useCity() — never hard-code it.
const Ctx = createContext<{ cityId: string; setCityId: (id: string) => void }>({
  cityId: DEFAULT_CITY,
  setCityId: () => undefined,
});

export function CityProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [cityId, setCityState] = useState<string>(() => {
    try {
      return localStorage.getItem(KEY) || DEFAULT_CITY;
    } catch {
      return DEFAULT_CITY;
    }
  });

  const setCityId = (id: string) => {
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* ignore */
    }
    setCityState(id);
  };

  // A signed-in user's profile city wins over the guest preference.
  const effective = profile?.city_id ?? cityId;
  return <Ctx.Provider value={{ cityId: effective, setCityId }}>{children}</Ctx.Provider>;
}

export const useCity = () => useContext(Ctx);
