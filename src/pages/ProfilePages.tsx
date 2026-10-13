import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowLeftRight,
  Bell,
  Camera,
  ChevronRight,
  Flag,
  Heart,
  LayoutList,
  LogOut,
  Settings,
  Shield,
  UserX,
  Ban,
  CircleHelp,
  MapPin,
  MessageCircle,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import {
  useBlocks,
  useCreateAppeal,
  useMyAppeals,
  usePublicProfile,
  useSetBlock,
  useUpdateProfile,
} from '@/api/account';
import { useFavoriteIds, useMyListings, useUserListings } from '@/api/listings';
import { useUnreadMessages } from '@/api/chat';
import { useCities } from '@/api/reference';
import { uploadAvatar } from '@/api/photos';
import { ReportButton } from '@/components/ReportDialog';
import { ListingGrid, ListingGridSkeleton } from '@/components/listing/parts';
import {
  Avatar,
  ConfirmDialog,
  Counter,
  EmptyState,
  ErrorState,
  InlineError,
  Modal,
  Notice,
  PageLoader,
  Spinner,
} from '@/components/ui';
import { LIMITS } from '@/config/listing';
import { localizedName, useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { formatDate, formatSinceMonth } from '@/lib/format';
import { ACCEPT_ATTR } from '@/lib/image-client';
import { profileSchema } from '@/lib/validation';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';

export function MePage() {
  const t = useT();
  const { profile, user, isModerator, restrictions, signOut } = useAuth();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const appeals = useMyAppeals();
  const mine = useMyListings();
  const favs = useFavoriteIds();
  const cities = useCities();
  const unread = useUnreadMessages();
  const [appealFor, setAppealFor] = useState<string | null>(null);

  if (!profile || !user) return <PageLoader />;

  const own = mine.data ?? [];
  const stats = [
    { n: own.filter((l) => l.status !== 'draft').length, label: t.profile.statListings },
    { n: favs.data?.size ?? 0, label: t.profile.statFavorites },
    { n: own.filter((l) => l.status === 'resolved').length, label: t.profile.statResolved },
  ];
  const links = [
    { to: '/me/listings', icon: LayoutList, label: t.nav.myListings },
    { to: '/favorites', icon: Heart, label: t.nav.favorites },
    { to: '/chats', icon: MessageCircle, label: t.nav.chats, badge: unread.data },
    { to: '/me/activity', icon: ArrowLeftRight, label: t.nav.activity },
    { to: '/notifications', icon: Bell, label: t.nav.notifications },
    { to: '/me/reports', icon: Flag, label: t.profile.myReports },
    { to: '/settings', icon: Settings, label: t.nav.settings },
    { to: '/safety', icon: CircleHelp, label: t.profile.help },
    ...(isModerator ? [{ to: '/admin', icon: Shield, label: t.nav.admin }] : []),
  ];
  const city = cities.data?.find((c) => c.id === profile.city_id);

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <h1 className="text-[22px] leading-tight font-extrabold">{t.profile.title}</h1>
      <div className="flex items-center gap-4">
        <AvatarUpload />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[20px] font-extrabold">{profile.display_name}</p>
          <p className="text-text-2 mt-0.5 flex items-center gap-1 text-sm">
            <MapPin className="size-4 shrink-0" aria-hidden />
            {localizedName(city)} · {t.listing.memberSinceInline} {formatSinceMonth(profile.created_at)}
          </p>
          <button
            type="button"
            className="text-primary-ink mt-1 text-sm font-semibold"
            onClick={() => setEditing(true)}
          >
            {t.profile.editProfile}
          </button>
        </div>
      </div>
      {profile.bio && <p className="user-text text-text-2 text-[15px]">{profile.bio}</p>}

      <dl className="card divide-line grid grid-cols-3 divide-x py-3">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col-reverse items-center px-2 text-center">
            <dt className="text-text-2 text-xs">{s.label}</dt>
            <dd className="text-[20px] font-extrabold tabular-nums">{mine.isPending ? '–' : s.n}</dd>
          </div>
        ))}
      </dl>

      {restrictions.length > 0 && (
        <Notice icon={Ban} tone="warning">
          <p className="font-bold">{t.profile.restrictionsTitle}</p>
          <ul className="mt-1 space-y-2">
            {restrictions.map((r) => (
              <li key={r.id}>
                {t.admin.kind[r.kind]} —{' '}
                {r.expires_at
                  ? `${t.profile.restrictionUntil} ${formatDate(r.expires_at)}`
                  : t.profile.restrictionForever}
                . <span className="opacity-90">{r.reason}</span>
                {appeals.data?.some((a) => a.restriction_id === r.id && a.status === 'new') ? (
                  <span className="ml-1 font-semibold">· {t.listing.appealSent}</span>
                ) : (
                  <button
                    type="button"
                    className="ml-1 font-semibold underline"
                    onClick={() => setAppealFor(r.id)}
                  >
                    {t.listing.appeal}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Notice>
      )}

      <nav className="card divide-line divide-y overflow-hidden">
        {links.map((l) => (
          <Link
            key={l.to}
            to={l.to}
            className="hover:bg-surface-2 flex min-h-[54px] items-center gap-3.5 px-4"
          >
            <l.icon className="text-text size-5" aria-hidden />
            <span className="flex-1 text-[15px] font-medium">{l.label}</span>
            {!!l.badge && (
              <span className="bg-primary text-on-primary flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold">
                {l.badge}
              </span>
            )}
            <ChevronRight className="text-text-2 size-5" aria-hidden />
          </Link>
        ))}
      </nav>

      <button
        type="button"
        className="btn-ghost text-danger w-full"
        onClick={async () => {
          await signOut('local');
          navigate('/', { replace: true });
        }}
      >
        <LogOut className="size-5" aria-hidden />
        {t.common.logout}
      </button>

      {editing && <EditProfileDialog onClose={() => setEditing(false)} />}
      {appealFor && <RestrictionAppeal restrictionId={appealFor} onClose={() => setAppealFor(null)} />}
    </div>
  );
}

function RestrictionAppeal({ restrictionId, onClose }: { restrictionId: string; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const m = useCreateAppeal();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title={t.listing.appeal}
      footer={
        <button
          type="button"
          className="btn-primary"
          disabled={text.trim().length < 10 || m.isPending}
          onClick={() =>
            m.mutate(
              { restriction_id: restrictionId, message: text.trim() },
              {
                onSuccess: () => {
                  qc.invalidateQueries({ queryKey: ['my-appeals'] });
                  toast(t.listing.appealSent);
                  onClose();
                },
              },
            )
          }
        >
          {t.common.confirm}
        </button>
      }
    >
      <textarea
        aria-label={t.listing.appeal}
        rows={4}
        maxLength={1000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="field-input"
      />
      <div className="mt-2">
        <InlineError error={m.error} />
      </div>
    </Modal>
  );
}

function AvatarUpload() {
  const t = useT();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="relative shrink-0">
      <Avatar path={profile?.avatar_path} name={profile?.display_name} size={72} />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        className="border-surface bg-primary text-on-primary absolute -right-1 -bottom-1 flex size-9 items-center justify-center rounded-full border-2"
        aria-label={t.profile.changeAvatar}
      >
        {busy ? <Spinner className="size-4" /> : <Camera className="size-4" />}
      </button>
      <input
        ref={input}
        type="file"
        accept={ACCEPT_ATTR}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setBusy(true);
          try {
            await uploadAvatar(f);
            await qc.invalidateQueries({ queryKey: ['profile'] });
            toast(t.common.saved);
          } catch (err) {
            toast(err instanceof Error ? err.message : errorMessage(err), 'error');
          } finally {
            setBusy(false);
            e.target.value = '';
          }
        }}
      />
    </div>
  );
}

function EditProfileDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { profile } = useAuth();
  const toast = useToast();
  const update = useUpdateProfile();
  const form = useForm<z.input<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: { display_name: profile?.display_name ?? '', bio: profile?.bio ?? '' },
  });
  const bio = form.watch('bio') ?? '';
  const submit = form.handleSubmit((v) =>
    update.mutate(
      { display_name: v.display_name.trim(), bio: v.bio?.trim() || null },
      { onSuccess: () => (toast(t.common.saved), onClose()) },
    ),
  );
  return (
    <Modal
      open
      onClose={onClose}
      title={t.profile.editProfile}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t.common.cancel}
          </button>
          <button type="submit" form="profile-form" className="btn-primary" disabled={update.isPending}>
            {update.isPending && <Spinner className="size-4" />}
            {t.common.save}
          </button>
        </>
      }
    >
      <form id="profile-form" onSubmit={submit} noValidate className="space-y-4">
        <div>
          <label htmlFor="pf-name" className="field-label">
            {t.auth.displayName}
          </label>
          <input
            id="pf-name"
            className="field-input"
            maxLength={LIMITS.displayNameMax}
            aria-invalid={Boolean(form.formState.errors.display_name)}
            {...form.register('display_name')}
          />
          {form.formState.errors.display_name && (
            <p className="field-error">{form.formState.errors.display_name.message}</p>
          )}
        </div>
        <div>
          <div className="flex items-end justify-between">
            <label htmlFor="pf-bio" className="field-label">
              {t.profile.bio}
            </label>
            <Counter value={bio.length} max={LIMITS.bioMax} />
          </div>
          <textarea
            id="pf-bio"
            rows={3}
            maxLength={LIMITS.bioMax}
            placeholder={t.profile.bioPlaceholder}
            className="field-input"
            {...form.register('bio')}
          />
        </div>
        <InlineError error={update.error} />
      </form>
    </Modal>
  );
}

export function PublicProfilePage() {
  const { id } = useParams();
  const t = useT();
  const { user } = useAuth();
  const toast = useToast();
  const p = usePublicProfile(id);
  const listings = useUserListings(id);
  const blocks = useBlocks();
  const setBlock = useSetBlock();
  const [confirmBlock, setConfirmBlock] = useState(false);

  if (p.isPending) return <PageLoader />;
  if (p.isError) return <ErrorState error={p.error} onRetry={() => p.refetch()} />;
  if (!p.data) return <EmptyState icon={UserX} title={t.common.notFoundTitle} />;

  const prof = p.data;
  const isMe = user?.id === prof.id;
  const blocked = blocks.data?.some((b) => b.blocked_id === prof.id) ?? false;

  return (
    <div className="space-y-6">
      <div className="card flex flex-wrap items-center gap-4 p-5">
        <Avatar path={prof.avatar_path} name={prof.display_name} size={72} />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-extrabold break-words">
            {prof.is_deleted ? t.common.deletedUser : prof.display_name}
          </h1>
          <p className="text-text-2 text-sm">
            {t.listing.memberSince} {formatSinceMonth(prof.created_at)}
          </p>
          {prof.bio && !prof.is_deleted && <p className="user-text mt-2 text-[15px]">{prof.bio}</p>}
        </div>
        {user && !isMe && !prof.is_deleted && (
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <button
              type="button"
              className="btn-secondary"
              disabled={setBlock.isPending}
              onClick={() =>
                blocked
                  ? setBlock.mutate(
                      { userId: prof.id, block: false },
                      { onError: (e) => toast(errorMessage(e), 'error') },
                    )
                  : setConfirmBlock(true)
              }
            >
              <Ban className="size-4" aria-hidden />
              {blocked ? t.profile.unblockUser : t.profile.blockUser}
            </button>
            <ReportButton
              target={{ target_type: 'user', target_user_id: prof.id }}
              className="btn-ghost text-text-2"
            />
          </div>
        )}
      </div>
      <section>
        <h2 className="mb-3 text-lg font-extrabold">{t.profile.listings}</h2>
        {listings.isPending ? (
          <ListingGridSkeleton count={4} />
        ) : listings.data?.length ? (
          <ListingGrid items={listings.data} />
        ) : (
          <p className="text-text-2">{t.profile.noListings}</p>
        )}
      </section>
      <ConfirmDialog
        open={confirmBlock}
        title={t.profile.blockUser}
        text={t.profile.blockConfirm}
        confirmLabel={t.profile.blockUser}
        danger
        pending={setBlock.isPending}
        onClose={() => setConfirmBlock(false)}
        onConfirm={() =>
          setBlock.mutate(
            { userId: prof.id, block: true },
            {
              onSuccess: () => {
                toast(t.profile.blocked);
                setConfirmBlock(false);
              },
              onError: (e) => toast(errorMessage(e), 'error'),
            },
          )
        }
      />
    </div>
  );
}
