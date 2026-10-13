import type { Session, User } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Tables } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

export type Profile = Tables<'profiles'>;

interface AuthValue {
  session: Session | null;
  user: User | null;
  ready: boolean;
  profile: Profile | null;
  isModerator: boolean;
  isAdmin: boolean;
  restrictions: Tables<'user_restrictions'>[];
  /** true right after an unexpected sign-out (expired/revoked session) */
  sessionExpired: boolean;
  signOut: (scope?: 'local' | 'global') => Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const intentionalSignOut = useRef(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setReady(true);
      if (event === 'SIGNED_OUT') {
        if (!intentionalSignOut.current) setSessionExpired(true);
        intentionalSignOut.current = false;
        qc.clear(); // never keep another user's cached data
      }
      if (event === 'SIGNED_IN') setSessionExpired(false);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [qc]);

  const uid = session?.user.id;

  const profileQ = useQuery({
    queryKey: ['profile', uid],
    enabled: Boolean(uid),
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', uid!).single();
      if (error) throw error;
      return data;
    },
  });

  const rolesQ = useQuery({
    queryKey: ['my-roles', uid],
    enabled: Boolean(uid),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [roles, restr] = await Promise.all([
        supabase.from('user_roles').select('role').eq('user_id', uid!),
        supabase.from('user_restrictions').select('*').eq('user_id', uid!).is('lifted_at', null),
      ]);
      if (roles.error) throw roles.error;
      if (restr.error) throw restr.error;
      const now = Date.now();
      return {
        roles: roles.data.map((r) => r.role),
        restrictions: restr.data.filter((r) => !r.expires_at || new Date(r.expires_at).getTime() > now),
      };
    },
  });

  const value = useMemo<AuthValue>(() => {
    const roles = rolesQ.data?.roles ?? [];
    return {
      session,
      user: session?.user ?? null,
      ready,
      profile: profileQ.data ?? null,
      // UI hint only — every admin action is authorised again in the database.
      isModerator: roles.includes('moderator') || roles.includes('admin'),
      isAdmin: roles.includes('admin'),
      restrictions: rolesQ.data?.restrictions ?? [],
      sessionExpired,
      signOut: async (scope = 'local') => {
        intentionalSignOut.current = true;
        await supabase.auth.signOut({ scope });
      },
    };
  }, [session, ready, profileQ.data, rolesQ.data, sessionExpired]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
