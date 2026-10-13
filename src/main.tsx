import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { I18nProvider } from '@/i18n';
import { errorCode } from '@/lib/errors';
import { isConfigured } from '@/lib/env';
import { supabase } from '@/lib/supabase';
import { AuthProvider } from '@/providers/AuthProvider';
import { CityProvider } from '@/providers/CityProvider';
import { ThemeProvider } from '@/providers/ThemeProvider';
import { ToastProvider } from '@/providers/ToastProvider';
import { router } from '@/router';
import './index.css';

const NO_RETRY = new Set(['forbidden', 'not_found', 'session_expired', 'rate_limited', 'not_authenticated']);

/** An expired/revoked session is refreshed once; if that fails the user is signed out. */
async function handleAuthError(err: unknown) {
  if (errorCode(err) !== 'session_expired') return;
  const { error } = await supabase.auth.refreshSession();
  if (error) await supabase.auth.signOut({ scope: 'local' });
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleAuthError }),
  mutationCache: new MutationCache({ onError: handleAuthError }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => count < 2 && !NO_RETRY.has(errorCode(err) ?? ''),
    },
    mutations: { retry: false },
  },
});

function NotConfigured() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="card max-w-md p-6">
        <h1 className="text-xl font-extrabold">TAPTIM</h1>
        <p className="text-text-2 mt-2">
          Приложение не настроено: укажите <code>VITE_SUPABASE_URL</code> и{' '}
          <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> в файле <code>.env</code> (см. README).
        </p>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isConfigured ? (
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <ThemeProvider>
            <ToastProvider>
              <AuthProvider>
                <CityProvider>
                  <RouterProvider router={router} />
                </CityProvider>
              </AuthProvider>
            </ToastProvider>
          </ThemeProvider>
        </I18nProvider>
      </QueryClientProvider>
    ) : (
      <NotConfigured />
    )}
  </StrictMode>,
);
