import { FileWarning, TriangleAlert } from 'lucide-react';
import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import { RequireAuth, RequireModerator } from '@/components/guards';
import { EmptyState, PageLoader } from '@/components/ui';
import HomePage from '@/pages/HomePage';
import SearchPage, { FeedHubPage } from '@/pages/SearchPage';
import ListingPage from '@/pages/ListingPage';

// Code-split everything that is not on the first screen.
const ListingFormPage = lazy(() => import('@/pages/ListingFormPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const auth = () => import('@/pages/auth/AuthPages');
const LoginPage = lazy(() => auth().then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => auth().then((m) => ({ default: m.RegisterPage })));
const CheckEmailPage = lazy(() => auth().then((m) => ({ default: m.CheckEmailPage })));
const ForgotPasswordPage = lazy(() => auth().then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => auth().then((m) => ({ default: m.ResetPasswordPage })));
const AuthCallbackPage = lazy(() => auth().then((m) => ({ default: m.AuthCallbackPage })));
const chat = () => import('@/pages/ChatPages');
const ChatsPage = lazy(() => chat().then((m) => ({ default: m.ChatsPage })));
const ChatPage = lazy(() => chat().then((m) => ({ default: m.ChatPage })));
const profile = () => import('@/pages/ProfilePages');
const MePage = lazy(() => profile().then((m) => ({ default: m.MePage })));
const PublicProfilePage = lazy(() => profile().then((m) => ({ default: m.PublicProfilePage })));
const my = () => import('@/pages/MyPages');
const MyListingsPage = lazy(() => my().then((m) => ({ default: m.MyListingsPage })));
const FavoritesPage = lazy(() => my().then((m) => ({ default: m.FavoritesPage })));
const NotificationsPage = lazy(() => my().then((m) => ({ default: m.NotificationsPage })));
const ActivityPage = lazy(() => my().then((m) => ({ default: m.ActivityPage })));
const MyReportsPage = lazy(() => my().then((m) => ({ default: m.MyReportsPage })));
const content = () => import('@/pages/ContentPages');
const SafetyPage = lazy(() => content().then((m) => ({ default: m.SafetyPage })));
const RulesPage = lazy(() => content().then((m) => ({ default: m.RulesPage })));
const TermsPage = lazy(() => content().then((m) => ({ default: m.TermsPage })));
const PrivacyPage = lazy(() => content().then((m) => ({ default: m.PrivacyPage })));
const admin = () => import('@/pages/admin/AdminPages');
const AdminLayout = lazy(() => admin().then((m) => ({ default: m.AdminLayout })));
const AdminDashboard = lazy(() => admin().then((m) => ({ default: m.AdminDashboard })));
const AdminReports = lazy(() => admin().then((m) => ({ default: m.AdminReports })));
const AdminListings = lazy(() => admin().then((m) => ({ default: m.AdminListings })));
const AdminUsers = lazy(() => admin().then((m) => ({ default: m.AdminUsers })));
const AdminAppeals = lazy(() => admin().then((m) => ({ default: m.AdminAppeals })));
const AdminLog = lazy(() => admin().then((m) => ({ default: m.AdminLog })));

const s = (el: ReactNode) => <Suspense fallback={<PageLoader />}>{el}</Suspense>;

function RouteError() {
  const err = useRouteError();
  const notFound = isRouteErrorResponse(err) && err.status === 404;
  // Never render the raw error (may contain internals); log it for developers.
  if (!notFound) console.error(err);
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <EmptyState
        icon={notFound ? FileWarning : TriangleAlert}
        title={notFound ? 'Страница не найдена' : 'Что-то пошло не так'}
        text={
          notFound
            ? 'Возможно, ссылка устарела.'
            : 'Обновите страницу. Если ошибка повторяется — попробуйте позже.'
        }
        action={
          <Link to="/" className="btn-primary" reloadDocument={!notFound}>
            На главную
          </Link>
        }
      />
    </div>
  );
}

function NotFound() {
  return (
    <EmptyState
      icon={FileWarning}
      title="Страница не найдена"
      text="Возможно, объявление закрыто или ссылка устарела."
      action={
        <Link to="/" className="btn-primary">
          На главную
        </Link>
      }
    />
  );
}

export const router = createBrowserRouter([
  // Auth screens: full-page, no app chrome
  { path: '/login', element: s(<LoginPage />), errorElement: <RouteError /> },
  { path: '/register', element: s(<RegisterPage />), errorElement: <RouteError /> },
  { path: '/check-email', element: s(<CheckEmailPage />), errorElement: <RouteError /> },
  { path: '/forgot', element: s(<ForgotPasswordPage />), errorElement: <RouteError /> },
  { path: '/auth/callback', element: s(<AuthCallbackPage />), errorElement: <RouteError /> },
  { path: '/auth/reset', element: s(<ResetPasswordPage />), errorElement: <RouteError /> },
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/search', element: <SearchPage /> },
      { path: '/lost', element: <FeedHubPage key="lost" hub="lostfound" type="lost" /> },
      { path: '/found', element: <FeedHubPage key="found" hub="lostfound" type="found" /> },
      { path: '/free', element: <FeedHubPage key="free" hub="give" type="giveaway" /> },
      { path: '/exchange', element: <FeedHubPage key="exchange" hub="give" type="exchange" /> },
      { path: '/wanted', element: <FeedHubPage key="wanted" hub="give" type="wanted" /> },
      { path: '/listing/:id', element: <ListingPage /> },
      { path: '/u/:id', element: s(<PublicProfilePage />) },
      { path: '/settings', element: s(<SettingsPage />) },
      { path: '/safety', element: s(<SafetyPage />) },
      { path: '/rules', element: s(<RulesPage />) },
      { path: '/terms', element: s(<TermsPage />) },
      { path: '/privacy', element: s(<PrivacyPage />) },
      {
        element: <RequireAuth />,
        children: [
          { path: '/new', element: s(<ListingFormPage />) },
          { path: '/listing/:id/edit', element: s(<ListingFormPage />) },
          { path: '/chats', element: s(<ChatsPage />) },
          { path: '/chats/:id', element: s(<ChatPage />) },
          { path: '/me', element: s(<MePage />) },
          { path: '/me/listings', element: s(<MyListingsPage />) },
          { path: '/me/activity', element: s(<ActivityPage />) },
          { path: '/me/reports', element: s(<MyReportsPage />) },
          { path: '/favorites', element: s(<FavoritesPage />) },
          { path: '/notifications', element: s(<NotificationsPage />) },
        ],
      },
      {
        path: '/admin',
        element: <RequireModerator>{s(<AdminLayout />)}</RequireModerator>,
        children: [
          { index: true, element: s(<AdminDashboard />) },
          { path: 'reports', element: s(<AdminReports />) },
          { path: 'listings', element: s(<AdminListings />) },
          { path: 'users', element: s(<AdminUsers />) },
          { path: 'appeals', element: s(<AdminAppeals />) },
          { path: 'log', element: s(<AdminLog />) },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
