import {
  ArrowLeftRight,
  Bell,
  Check,
  ChevronDown,
  House,
  MapPin,
  MessageCircle,
  PackageSearch,
  Plus,
  Shield,
  User,
  WifiOff,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, ScrollRestoration, useLocation, useNavigate } from 'react-router';
import { useUnreadNotifications, useUpdateProfile } from '@/api/account';
import { useRealtimeInbox, useUnreadMessages } from '@/api/chat';
import { useCities } from '@/api/reference';
import { Avatar, Modal } from '@/components/ui';
import { localizedName, useT } from '@/i18n';
import { useAuth } from '@/providers/AuthProvider';
import { useCity } from '@/providers/CityProvider';
import { useToast } from '@/providers/ToastProvider';

/** Brand mark from the concept: deep-green tile with a leaf-shaped "T". */
export function LogoMark({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={`shrink-0 ${className}`} aria-hidden>
      <rect width="32" height="32" rx="9" className="fill-primary-deep" />
      <path
        d="M7.5 13.2c0-3.3 2.4-5 5.6-5H24.5v4.3h-6v11.3c0 1.2-.9 2.1-2.1 2.1h-.6V12.5h-2.6c-2.4 0-4.2.3-5.7.7Z"
        fill="#fff"
      />
    </svg>
  );
}

export function Logo({ className = '' }: { className?: string }) {
  return (
    <Link
      to="/"
      className={`flex items-center gap-2 rounded-lg ${className}`}
      aria-label="TAPTIM — на главную"
    >
      <LogoMark />
      <span className="text-text text-[19px] font-extrabold tracking-[0.04em]">TAPTIM</span>
    </Link>
  );
}

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

function CitySelector() {
  const t = useT();
  const { user } = useAuth();
  const { cityId, setCityId } = useCity();
  const cities = useCities();
  const updateProfile = useUpdateProfile();
  const [open, setOpen] = useState(false);
  const city = cities.data?.find((c) => c.id === cityId);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-text hover:bg-surface-2 -ml-2 inline-flex min-h-10 min-w-0 items-center gap-1 rounded-full px-2 text-[15px] font-semibold"
        aria-label={`${t.common.city}: ${localizedName(city) || 'Шымкент'}`}
      >
        <MapPin className="text-primary size-[18px] shrink-0" aria-hidden />
        <span className="truncate">{localizedName(city) || 'Шымкент'}</span>
        <ChevronDown className="text-text-2 size-4 shrink-0" aria-hidden />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={t.common.city}>
        <ul className="space-y-1.5 pb-2">
          {(cities.data ?? []).map((c) => (
            <li key={c.id}>
              <button
                type="button"
                disabled={!c.is_active}
                onClick={() => {
                  setCityId(c.id);
                  if (user) updateProfile.mutate({ city_id: c.id });
                  setOpen(false);
                }}
                className="hover:bg-surface-2 flex min-h-12 w-full items-center gap-3 rounded-xl px-3.5 text-left disabled:opacity-50 disabled:hover:bg-transparent"
              >
                <MapPin className="text-primary size-5" aria-hidden />
                <span className="flex-1 font-semibold">{localizedName(c)}</span>
                {!c.is_active && <span className="text-text-2 text-sm">{t.common.soon}</span>}
                {c.id === cityId && <Check className="text-primary size-5" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}

function Badge({ n }: { n: number | undefined }) {
  if (!n) return null;
  return (
    <span className="bg-danger ring-bg dark:text-bg absolute -top-1 -right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11px] font-bold text-white ring-2">
      {n > 99 ? '99+' : n}
    </span>
  );
}

const LOST_FOUND = ['/lost', '/found'];
const GIVE = ['/free', '/exchange', '/wanted'];

function BottomNav() {
  const t = useT();
  const { pathname } = useLocation();
  const item = (to: string, label: string, icon: ReactNode, active: boolean) => (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${active ? 'text-primary-ink' : 'text-text-2'}`}
    >
      {icon}
      {label}
    </Link>
  );
  return (
    <nav
      aria-label="Основная навигация"
      className="border-line bg-surface/95 fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <div className="mx-auto flex max-w-lg items-stretch px-1">
        {item('/', t.nav.home, <House className="size-6" aria-hidden />, pathname === '/')}
        {item(
          '/lost',
          t.nav.lostFound,
          <PackageSearch className="size-6" aria-hidden />,
          LOST_FOUND.includes(pathname),
        )}
        <Link
          to="/new"
          className="text-text-2 flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold"
        >
          <span className="bg-primary text-on-primary dark:bg-cta dark:text-on-cta -my-1.5 flex size-9 items-center justify-center rounded-full shadow-sm">
            <Plus className="size-6" aria-hidden />
          </span>
          {t.nav.createShort}
        </Link>
        {item(
          '/free',
          t.nav.give,
          <ArrowLeftRight className="size-6" aria-hidden />,
          GIVE.includes(pathname),
        )}
        {item('/me', t.nav.profile, <User className="size-6" aria-hidden />, pathname.startsWith('/me'))}
      </div>
    </nav>
  );
}

export function AppShell() {
  const t = useT();
  const { user, profile, isModerator, sessionExpired } = useAuth();
  const online = useOnline();
  const unreadMsg = useUnreadMessages();
  const unreadNotif = useUnreadNotifications();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const isHome = location.pathname === '/';
  useRealtimeInbox();

  useEffect(() => {
    if (sessionExpired) {
      toast(t.auth.sessionExpired, 'info');
      navigate(`/login?next=${encodeURIComponent(location.pathname)}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionExpired]);

  const desktopLink = (to: string, label: string, match: (p: string) => boolean) => (
    <NavLink
      to={to}
      className={() =>
        `rounded-full px-3.5 py-2 text-[15px] font-semibold transition-colors ${match(location.pathname) ? 'bg-primary-soft text-primary-ink' : 'text-text hover:bg-surface-2'}`
      }
    >
      {label}
    </NavLink>
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="bg-primary text-on-primary sr-only z-50 rounded-lg px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {t.nav.skipToContent}
      </a>
      {/* On phones the app bar lives only on the home screen (as in the concept); other screens have own headers. */}
      <header
        className={`bg-bg/90 md:border-line sticky top-0 z-30 pt-[env(safe-area-inset-top)] backdrop-blur md:block md:border-b ${isHome ? '' : 'hidden'}`}
      >
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
          <Logo className="hidden md:flex" />
          <div className="min-w-0 md:ml-3">
            <CitySelector />
          </div>
          <nav aria-label="Разделы" className="ml-3 hidden items-center gap-1 lg:flex">
            {desktopLink('/', t.nav.home, (p) => p === '/')}
            {desktopLink('/lost', t.nav.lostFound, (p) => LOST_FOUND.includes(p))}
            {desktopLink('/free', t.nav.give, (p) => GIVE.includes(p))}
            {desktopLink('/search', t.nav.search, (p) => p.startsWith('/search'))}
          </nav>
          <div className="ml-auto flex items-center gap-0.5">
            <Link to="/new" className="btn-primary mr-2 hidden md:inline-flex">
              <Plus className="size-5" aria-hidden />
              {t.nav.create}
            </Link>
            {isModerator && (
              <Link to="/admin" className="icon-btn" aria-label={t.nav.admin}>
                <Shield className="size-[22px]" />
              </Link>
            )}
            {user ? (
              <>
                <Link to="/chats" className="icon-btn relative" aria-label={t.nav.chats}>
                  <span className="relative">
                    <MessageCircle className="size-[22px]" aria-hidden />
                    <Badge n={unreadMsg.data} />
                  </span>
                </Link>
                <Link to="/notifications" className="icon-btn relative" aria-label={t.nav.notifications}>
                  <span className="relative">
                    <Bell className="size-[22px]" aria-hidden />
                    <Badge n={unreadNotif.data} />
                  </span>
                </Link>
                <Link to="/me" className="ml-1 rounded-full" aria-label={t.nav.profile}>
                  <Avatar path={profile?.avatar_path} name={profile?.display_name} size={34} />
                </Link>
              </>
            ) : (
              <Link to="/login" className="btn-secondary min-h-10 px-4">
                {t.common.login}
              </Link>
            )}
          </div>
        </div>
      </header>
      {!online && (
        <div
          className="bg-warning-soft text-warning sticky top-0 z-30 flex items-center gap-2 px-4 py-2 text-sm md:top-14"
          role="status"
        >
          <WifiOff className="size-4 shrink-0" aria-hidden />
          <span>{t.common.offline}</span>
        </div>
      )}
      <main
        id="main"
        className={`mx-auto w-full max-w-6xl flex-1 px-4 pb-[calc(88px+env(safe-area-inset-bottom))] md:pt-6 md:pb-12 ${isHome ? 'pt-2' : 'pt-[max(0.75rem,env(safe-area-inset-top))]'}`}
      >
        <Outlet />
      </main>
      <footer className="border-line hidden border-t py-6 md:block">
        <div className="text-text-2 mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 text-sm">
          <span>© TAPTIM · {t.common.slogan}</span>
          <Link to="/safety" className="hover:text-text">
            {t.nav.safety}
          </Link>
          <Link to="/rules" className="hover:text-text">
            {t.nav.rules}
          </Link>
          <Link to="/terms" className="hover:text-text">
            {t.auth.terms}
          </Link>
          <Link to="/privacy" className="hover:text-text">
            {t.auth.privacy}
          </Link>
        </div>
      </footer>
      <BottomNav />
      <ScrollRestoration />
    </div>
  );
}
