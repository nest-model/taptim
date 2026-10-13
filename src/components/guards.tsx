import { Lock, ShieldOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router';
import { EmptyState, PageLoader } from '@/components/ui';
import { useT } from '@/i18n';
import { useAuth } from '@/providers/AuthProvider';

export function RequireAuth({ children }: { children?: ReactNode }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <PageLoader />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return children ?? <Outlet />;
}

/** UI gate only. Real protection: RLS + assert_moderator() in every admin RPC. */
export function RequireModerator({ children }: { children?: ReactNode }) {
  const { user, ready, isModerator } = useAuth();
  const t = useT();
  const loc = useLocation();
  if (!ready) return <PageLoader />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (!isModerator) return <EmptyState icon={ShieldOff} title={t.admin.noAccess} />;
  return children ?? <Outlet />;
}

export function LoginPrompt({ text }: { text?: string }) {
  const t = useT();
  const loc = useLocation();
  return (
    <EmptyState
      icon={Lock}
      title={t.auth.loginRequired}
      text={text ?? t.auth.loginRequiredText}
      action={
        <Link to={`/login?next=${encodeURIComponent(loc.pathname)}`} className="btn-primary">
          {t.common.login}
        </Link>
      }
    />
  );
}
