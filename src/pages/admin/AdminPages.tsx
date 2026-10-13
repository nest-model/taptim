import { ExternalLink, Gavel, Inbox, ScrollText, Search, ShieldCheck, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import {
  useAdminAppeals,
  useAdminDashboard,
  useAdminListings,
  useAdminReports,
  useAdminUsers,
  useDecideAppeal,
  useLiftRestriction,
  useModerationLog,
  useReportContext,
  useRestrictUser,
  useSetListingState,
  useSetRole,
  useUpdateReport,
  useUserRestrictions,
} from '@/api/admin';
import { StatusBadge, TypeBadge } from '@/components/listing/parts';
import { EmptyState, ErrorState, InlineError, Modal, PageLoader, Spinner } from '@/components/ui';
import { LISTING_TYPES, type ListingStatus, type ListingType } from '@/config/listing';
import type { Enums } from '@/lib/database.types';
import { useT } from '@/i18n';
import { formatDate, relativeTime } from '@/lib/format';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { errorMessage } from '@/lib/errors';

export function AdminLayout() {
  const t = useT();
  const tabs = [
    ['/admin', t.admin.dashboard, true],
    ['/admin/reports', t.admin.reports, false],
    ['/admin/listings', t.admin.listings, false],
    ['/admin/users', t.admin.users, false],
    ['/admin/appeals', t.admin.appeals, false],
    ['/admin/log', t.admin.log, false],
  ] as const;
  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <ShieldCheck className="text-primary size-6" aria-hidden />
        <h1 className="text-[22px] font-extrabold tracking-tight">{t.admin.title}</h1>
      </div>
      <nav
        className="no-scrollbar -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1"
        aria-label={t.admin.title}
      >
        {tabs.map(([to, label, end]) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `chip ${isActive ? 'bg-primary text-on-primary hover:bg-primary' : ''}`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}

function Stat({ label, value, to }: { label: string; value: number | string; to?: string }) {
  const body = (
    <>
      <p className="text-text-2 text-[13px] font-semibold">{label}</p>
      <p className="mt-1 text-[28px] font-extrabold tabular-nums">{value}</p>
    </>
  );
  return to ? (
    <Link to={to} className="card block p-4 hover:shadow-md">
      {body}
    </Link>
  ) : (
    <div className="card p-4">{body}</div>
  );
}

export function AdminDashboard() {
  const t = useT();
  const q = useAdminDashboard();
  if (q.isPending) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const sum = (o: Partial<Record<string, number>>) =>
    Object.values(o).reduce<number>((a, b) => a + (b ?? 0), 0);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t.admin.openReports} value={d.reports_open} to="/admin/reports" />
        <Stat
          label={t.admin.pendingReview}
          value={d.listings_pending_review}
          to="/admin/listings?state=pending_review"
        />
        <Stat label={t.admin.openAppeals} value={d.appeals_open} to="/admin/appeals" />
        <Stat label={t.admin.restrictions} value={d.restrictions_active} />
        <Stat label={t.admin.usersTotal} value={d.users_total} />
        <Stat label={t.admin.usersWeek} value={d.users_7d} />
        <Stat label={t.admin.activeListings} value={sum(d.listings_active)} />
        <Stat label={t.admin.listingsWeek} value={d.listings_7d} />
      </div>
      <div className="card overflow-x-auto p-4">
        <table className="w-full min-w-[420px] text-left text-[15px]">
          <thead className="text-text-2 text-xs">
            <tr>
              <th className="py-2 font-semibold">{t.feed.type}</th>
              <th className="py-2 text-right font-semibold">{t.admin.activeListings}</th>
              <th className="py-2 text-right font-semibold">{t.admin.resolved30}</th>
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {LISTING_TYPES.map((ty) => (
              <tr key={ty}>
                <td className="py-2.5">{t.types[ty].plural}</td>
                <td className="py-2.5 text-right tabular-nums">{d.listings_active[ty] ?? 0}</td>
                <td className="py-2.5 text-right tabular-nums">{d.resolved_30d[ty] ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type ReportRow = NonNullable<ReturnType<typeof useAdminReports>['data']>[number];
const OPEN: Enums<'report_status'>[] = ['new', 'in_review', 'needs_info'];
const CLOSED: Enums<'report_status'>[] = ['resolved', 'rejected'];

export function AdminReports() {
  const t = useT();
  const [closed, setClosed] = useState(false);
  const q = useAdminReports(closed ? CLOSED : OPEN);
  const [open, setOpen] = useState<ReportRow | null>(null);
  return (
    <div>
      <div className="mb-4 flex gap-2">
        <button type="button" className="chip" aria-pressed={!closed} onClick={() => setClosed(false)}>
          {t.reports.status.new} / {t.reports.status.in_review}
        </button>
        <button type="button" className="chip" aria-pressed={closed} onClick={() => setClosed(true)}>
          {t.reports.status.resolved} / {t.reports.status.rejected}
        </button>
      </div>
      {q.isPending ? (
        <PageLoader />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data.length ? (
        <EmptyState icon={Inbox} title={t.admin.noItems} />
      ) : (
        <ul className="space-y-2">
          {q.data.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setOpen(r)}
                className="card w-full p-4 text-left hover:shadow-md"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{t.reports.reasons[r.reason!]}</span>
                  <span className="text-text-2 text-sm">· {t.reports.targets[r.target_type!]}</span>
                  {(r.distinct_reporters ?? 0) > 1 && (
                    <span className="bg-danger-soft text-danger rounded-full px-2 py-0.5 text-xs font-bold">
                      {t.admin.distinctReporters}: {r.distinct_reporters}
                    </span>
                  )}
                  <span className="bg-surface-2 ml-auto rounded-full px-2.5 py-1 text-xs font-semibold">
                    {t.reports.status[r.status!]}
                  </span>
                </div>
                <p className="mt-1 truncate text-sm">{r.listing_title ?? r.target_user_name ?? '—'}</p>
                <p className="text-text-2 mt-0.5 text-xs">{relativeTime(r.created_at)}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <ReportDetail report={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ReportDetail({ report: r, onClose }: { report: ReportRow; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const [showCtx, setShowCtx] = useState(false);
  const ctx = useReportContext(r.id!, showCtx || r.target_type !== 'message');
  const update = useUpdateReport();
  const setState = useSetListingState();
  const restrict = useRestrictUser();
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [infoReq, setInfoReq] = useState('');
  const [kind, setKind] = useState<Enums<'restriction_kind'>>('posting');
  const [until, setUntil] = useState('');
  const busy = update.isPending || setState.isPending || restrict.isPending;
  const done =
    (msg = t.common.saved) =>
    () =>
      toast(msg);
  const onErr = (e: unknown) => toast(errorMessage(e), 'error');

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t.reports.reasons[r.reason!]} · ${t.reports.targets[r.target_type!]}`}
    >
      <div className="space-y-4 text-[15px]">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-text-2">{t.reports.status.new}</dt>
          <dd>{formatDate(r.created_at!)}</dd>
          <dt className="text-text-2">Заявитель</dt>
          <dd>
            {r.reporter_name} · {t.admin.reporterTrust}: {r.reporter_rejected}/{r.reporter_total}
          </dd>
          <dt className="text-text-2">Нарушитель</dt>
          <dd>{r.target_user_name ?? '—'}</dd>
          {r.listing_id && (
            <>
              <dt className="text-text-2">{t.reports.targets.listing}</dt>
              <dd>
                <Link
                  to={`/listing/${r.listing_id}`}
                  target="_blank"
                  className="text-primary-ink inline-flex items-center gap-1 underline"
                >
                  {r.listing_title}
                  <ExternalLink className="size-3.5" aria-hidden />
                </Link>
              </dd>
            </>
          )}
        </dl>
        {r.description && <p className="user-text bg-surface-2 rounded-xl p-3">{r.description}</p>}
        {r.reporter_reply && (
          <p className="user-text bg-info-soft text-info rounded-xl p-3">{r.reporter_reply}</p>
        )}

        {r.target_type === 'message' && !showCtx && (
          <div className="space-y-2">
            <p className="text-text-2 text-sm">{t.admin.contextNote}</p>
            <button type="button" className="btn-secondary" onClick={() => setShowCtx(true)}>
              {t.admin.viewContext}
            </button>
          </div>
        )}
        {ctx.data?.messages && (
          <ol className="border-line space-y-1.5 rounded-xl border p-3">
            {ctx.data.messages.map((m) => (
              <li
                key={m.id}
                className={`rounded-lg px-2.5 py-1.5 text-sm ${m.is_reported ? 'bg-danger-soft' : ''}`}
              >
                <span className="font-semibold">{m.sender_name}: </span>
                <span className="user-text">{m.body}</span>
              </li>
            ))}
          </ol>
        )}
        {ctx.data && (ctx.data.notes.length > 0 || ctx.data.actions.length > 0) && (
          <div className="space-y-1 text-sm">
            {ctx.data.notes.map((n, i) => (
              <p key={`n${i}`} className="bg-surface-2 rounded-lg p-2">
                <span className="font-semibold">{n.author}:</span> {n.body}
              </p>
            ))}
            {ctx.data.actions.map((a, i) => (
              <p key={`a${i}`} className="text-text-2">
                {relativeTime(a.created_at)} · {a.action} · {a.reason}
              </p>
            ))}
          </div>
        )}

        <div>
          <label htmlFor="r-note" className="field-label">
            {t.admin.note}
          </label>
          <textarea
            id="r-note"
            rows={2}
            className="field-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {r.status === 'new' && (
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() =>
                update.mutate({ id: r.id!, status: 'in_review', note }, { onSuccess: done(), onError: onErr })
              }
            >
              {t.reports.status.in_review}
            </button>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() =>
              update.mutate(
                { id: r.id!, status: 'resolved', note },
                { onSuccess: () => (toast(t.common.saved), onClose()), onError: onErr },
              )
            }
          >
            {t.reports.status.resolved}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() =>
              update.mutate(
                { id: r.id!, status: 'rejected', note },
                { onSuccess: () => (toast(t.common.saved), onClose()), onError: onErr },
              )
            }
          >
            {t.reports.status.rejected}
          </button>
        </div>

        <details className="border-line rounded-xl border p-3">
          <summary className="cursor-pointer font-semibold">{t.reports.status.needs_info}</summary>
          <div className="mt-3 space-y-2">
            <input
              aria-label={t.admin.infoRequest}
              placeholder={t.admin.infoRequest}
              className="field-input"
              value={infoReq}
              onChange={(e) => setInfoReq(e.target.value)}
              maxLength={500}
            />
            <button
              type="button"
              className="btn-secondary"
              disabled={busy || !infoReq.trim()}
              onClick={() =>
                update.mutate(
                  { id: r.id!, status: 'needs_info', infoRequest: infoReq },
                  { onSuccess: done(), onError: onErr },
                )
              }
            >
              {t.common.confirm}
            </button>
          </div>
        </details>

        <div className="border-line space-y-2 rounded-xl border p-3">
          <label htmlFor="r-reason" className="field-label">
            {t.admin.reason}
          </label>
          <input
            id="r-reason"
            className="field-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
          />
          {r.listing_id && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-danger"
                disabled={busy || reason.trim().length < 3}
                onClick={() =>
                  setState.mutate(
                    { id: r.listing_id!, state: 'hidden', reason, reportId: r.id! },
                    { onSuccess: done(), onError: onErr },
                  )
                }
              >
                {t.admin.hide}
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={busy || reason.trim().length < 3}
                onClick={() =>
                  setState.mutate(
                    { id: r.listing_id!, state: 'ok', reason, reportId: r.id! },
                    { onSuccess: done(), onError: onErr },
                  )
                }
              >
                {t.admin.restore}
              </button>
            </div>
          )}
          {r.target_user_id && (
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <select
                aria-label="Тип ограничения"
                className="field-input"
                value={kind}
                onChange={(e) => setKind(e.target.value as Enums<'restriction_kind'>)}
              >
                {(['posting', 'messaging', 'reporting', 'ban'] as const).map((k) => (
                  <option key={k} value={k}>
                    {t.admin.kind[k]}
                  </option>
                ))}
              </select>
              <input
                type="date"
                aria-label={t.admin.until}
                className="field-input"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
              />
              <button
                type="button"
                className="btn-danger"
                disabled={busy || reason.trim().length < 3}
                onClick={() =>
                  restrict.mutate(
                    {
                      userId: r.target_user_id!,
                      kind,
                      reason,
                      expiresAt: until ? new Date(`${until}T23:59:59+05:00`).toISOString() : undefined,
                      reportId: r.id!,
                    },
                    { onSuccess: done(), onError: onErr },
                  )
                }
              >
                {t.admin.restrict}
              </button>
            </div>
          )}
        </div>
        <InlineError error={update.error ?? setState.error ?? restrict.error} />
      </div>
    </Modal>
  );
}

export function AdminListings() {
  const t = useT();
  const toast = useToast();
  const initial = new URLSearchParams(window.location.search).get(
    'state',
  ) as Enums<'moderation_state'> | null;
  const [state, setStateFilter] = useState<Enums<'moderation_state'> | ''>(initial ?? '');
  const [q, setQ] = useState('');
  const list = useAdminListings({ state, q });
  const set = useSetListingState();
  const [target, setTarget] = useState<{ id: string; to: Enums<'moderation_state'> } | null>(null);
  const [reason, setReason] = useState('');
  return (
    <div>
      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_220px]">
        <div className="relative">
          <Search
            className="text-text-2 pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2"
            aria-hidden
          />
          <input
            aria-label={t.common.search}
            className="field-input pl-11"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.common.search}
          />
        </div>
        <select
          aria-label={t.admin.filterState}
          className="field-input"
          value={state}
          onChange={(e) => setStateFilter(e.target.value as Enums<'moderation_state'> | '')}
        >
          <option value="">{t.common.all}</option>
          <option value="pending_review">{t.moderation.pending_review}</option>
          <option value="hidden">{t.moderation.hidden}</option>
          <option value="ok">OK</option>
        </select>
      </div>
      {list.isPending ? (
        <PageLoader />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data.length ? (
        <EmptyState icon={Inbox} title={t.admin.noItems} />
      ) : (
        <ul className="space-y-2">
          {list.data.map((l) => (
            <li key={l.id} className="card flex flex-wrap items-center gap-3 p-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <TypeBadge type={l.type as ListingType} />
                  <StatusBadge
                    status={l.status as ListingStatus}
                    type={l.type as ListingType}
                    moderation={l.moderation_state === 'ok' ? null : l.moderation_state}
                  />
                </div>
                <Link
                  to={`/listing/${l.id}`}
                  target="_blank"
                  className="mt-1 block truncate font-semibold hover:underline"
                >
                  {l.title}
                </Link>
                <p className="text-text-2 text-xs">
                  {l.author_name} · {relativeTime(l.updated_at)}
                </p>
              </div>
              <div className="flex gap-2">
                {l.moderation_state !== 'hidden' && (
                  <button
                    type="button"
                    className="btn-secondary min-h-10 text-sm"
                    onClick={() => setTarget({ id: l.id!, to: 'hidden' })}
                  >
                    {t.admin.hide}
                  </button>
                )}
                {l.moderation_state !== 'ok' && (
                  <button
                    type="button"
                    className="btn-primary min-h-10 text-sm"
                    onClick={() => setTarget({ id: l.id!, to: 'ok' })}
                  >
                    {l.moderation_state === 'pending_review' ? t.admin.approve : t.admin.restore}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {target && (
        <Modal
          open
          onClose={() => setTarget(null)}
          title={target.to === 'hidden' ? t.admin.hide : t.admin.approve}
          footer={
            <button
              type="button"
              className={target.to === 'hidden' ? 'btn-danger' : 'btn-primary'}
              disabled={reason.trim().length < 3 || set.isPending}
              onClick={() =>
                set.mutate(
                  { id: target.id, state: target.to, reason },
                  {
                    onSuccess: () => {
                      toast(t.common.saved);
                      setTarget(null);
                      setReason('');
                    },
                    onError: (e) => toast(errorMessage(e), 'error'),
                  },
                )
              }
            >
              {set.isPending && <Spinner className="size-4" />}
              {t.common.confirm}
            </button>
          }
        >
          <label htmlFor="ls-reason" className="field-label">
            {t.admin.reason}
          </label>
          <input
            id="ls-reason"
            className="field-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
          />
        </Modal>
      )}
    </div>
  );
}

type UserRow = NonNullable<ReturnType<typeof useAdminUsers>['data']>[number];

export function AdminUsers() {
  const t = useT();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const users = useAdminUsers(debounced);
  const [open, setOpen] = useState<UserRow | null>(null);
  return (
    <div>
      <form
        className="relative mb-4"
        onSubmit={(e) => {
          e.preventDefault();
          setDebounced(q.trim());
        }}
      >
        <Search
          className="text-text-2 pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2"
          aria-hidden
        />
        <input
          aria-label={t.common.search}
          className="field-input pl-11"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Имя, ID или e-mail (только админ)"
        />
      </form>
      {users.isPending ? (
        <PageLoader />
      ) : users.isError ? (
        <ErrorState error={users.error} onRetry={() => users.refetch()} />
      ) : !users.data.length ? (
        <EmptyState icon={Users} title={t.admin.noItems} />
      ) : (
        <ul className="card divide-line divide-y overflow-hidden">
          {users.data.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => setOpen(u)}
                className="hover:bg-surface-2 flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{u.display_name}</span>
                  <span className="text-text-2 text-xs">
                    {formatDate(u.created_at!)} {u.email ? `· ${u.email}` : ''}
                  </span>
                </span>
                {u.roles?.map((r) => (
                  <span
                    key={r}
                    className="bg-primary-soft text-primary-ink rounded-full px-2 py-0.5 text-xs font-bold"
                  >
                    {r}
                  </span>
                ))}
                {u.active_restrictions?.map((k) => (
                  <span
                    key={k}
                    className="bg-danger-soft text-danger rounded-full px-2 py-0.5 text-xs font-bold"
                  >
                    {t.admin.kind[k]}
                  </span>
                ))}
                <span className="text-text-2 text-xs">⚑ {u.reports_against}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <UserDetail user={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function UserDetail({ user: u, onClose }: { user: UserRow; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const { isAdmin, user: me } = useAuth();
  const restr = useUserRestrictions(u.id!);
  const lift = useLiftRestriction();
  const restrict = useRestrictUser();
  const setRole = useSetRole();
  const [reason, setReason] = useState('');
  const [kind, setKind] = useState<Enums<'restriction_kind'>>('posting');
  const [until, setUntil] = useState('');
  const isMod = u.roles?.includes('moderator');
  const onErr = (e: unknown) => toast(errorMessage(e), 'error');
  return (
    <Modal open onClose={onClose} title={u.display_name ?? ''}>
      <div className="space-y-4">
        <p className="text-text-2 text-sm">
          ID: <span className="font-mono text-xs break-all">{u.id}</span>
        </p>
        <Link
          to={`/u/${u.id}`}
          target="_blank"
          className="text-primary-ink inline-flex items-center gap-1 text-sm underline"
        >
          Профиль <ExternalLink className="size-3.5" aria-hidden />
        </Link>
        <section>
          <h3 className="mb-2 font-bold">{t.profile.restrictionsTitle}</h3>
          {restr.isPending ? (
            <Spinner />
          ) : !restr.data?.length ? (
            <p className="text-text-2 text-sm">—</p>
          ) : (
            <ul className="space-y-2">
              {restr.data.map((r) => (
                <li key={r.id} className="border-line rounded-xl border p-3 text-sm">
                  <p className="font-semibold">
                    {t.admin.kind[r.kind]} ·{' '}
                    {r.expires_at ? formatDate(r.expires_at) : t.profile.restrictionForever}
                    {r.lifted_at && ` · снято ${formatDate(r.lifted_at)}`}
                  </p>
                  <p className="text-text-2">{r.reason}</p>
                  {!r.lifted_at && (
                    <button
                      type="button"
                      className="btn-ghost mt-1 -ml-3 min-h-9 text-sm"
                      disabled={lift.isPending || reason.trim().length < 3}
                      onClick={() =>
                        lift.mutate(
                          { id: r.id, reason },
                          { onSuccess: () => toast(t.common.saved), onError: onErr },
                        )
                      }
                    >
                      {t.admin.lift}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="border-line space-y-2 rounded-xl border p-3">
          <label htmlFor="u-reason" className="field-label">
            {t.admin.reason}
          </label>
          <input
            id="u-reason"
            className="field-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
          />
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <select
              aria-label="Тип ограничения"
              className="field-input"
              value={kind}
              onChange={(e) => setKind(e.target.value as Enums<'restriction_kind'>)}
            >
              {(['posting', 'messaging', 'reporting', 'ban'] as const).map((k) => (
                <option key={k} value={k}>
                  {t.admin.kind[k]}
                </option>
              ))}
            </select>
            <input
              type="date"
              aria-label={t.admin.until}
              className="field-input"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
            <button
              type="button"
              className="btn-danger"
              disabled={restrict.isPending || reason.trim().length < 3 || u.id === me?.id}
              onClick={() =>
                restrict.mutate(
                  {
                    userId: u.id!,
                    kind,
                    reason,
                    expiresAt: until ? new Date(`${until}T23:59:59+05:00`).toISOString() : undefined,
                  },
                  { onSuccess: () => toast(t.common.saved), onError: onErr },
                )
              }
            >
              {t.admin.restrict}
            </button>
          </div>
        </div>
        {isAdmin && u.id !== me?.id && (
          <button
            type="button"
            className="btn-secondary"
            disabled={setRole.isPending}
            onClick={() =>
              setRole.mutate(
                { userId: u.id!, role: 'moderator', grant: !isMod },
                { onSuccess: () => (toast(t.common.saved), onClose()), onError: onErr },
              )
            }
          >
            {isMod ? t.admin.revokeModerator : t.admin.grantModerator}
          </button>
        )}
      </div>
    </Modal>
  );
}

export function AdminAppeals() {
  const t = useT();
  const toast = useToast();
  const q = useAdminAppeals();
  const decide = useDecideAppeal();
  const [notes, setNotes] = useState<Record<string, string>>({});
  if (q.isPending) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const open = q.data.filter((a) => a.status === 'new');
  if (!open.length) return <EmptyState icon={Gavel} title={t.admin.noItems} />;
  return (
    <ul className="space-y-3">
      {open.map((a) => (
        <li key={a.id} className="card space-y-3 p-4">
          <p className="text-text-2 text-sm">
            {relativeTime(a.created_at)} ·{' '}
            {a.listing_id ? (
              <Link to={`/listing/${a.listing_id}`} target="_blank" className="text-primary-ink underline">
                {t.reports.targets.listing}
              </Link>
            ) : (
              t.profile.restrictionsTitle
            )}
          </p>
          <p className="user-text">{a.message}</p>
          <input
            aria-label={t.admin.note}
            placeholder={t.admin.note}
            className="field-input"
            value={notes[a.id] ?? ''}
            onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={decide.isPending}
              onClick={() =>
                decide.mutate(
                  { id: a.id, accept: true, note: notes[a.id] ?? '' },
                  { onSuccess: () => toast(t.common.saved), onError: (e) => toast(errorMessage(e), 'error') },
                )
              }
            >
              {t.admin.accept}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={decide.isPending}
              onClick={() =>
                decide.mutate(
                  { id: a.id, accept: false, note: notes[a.id] ?? '' },
                  { onSuccess: () => toast(t.common.saved), onError: (e) => toast(errorMessage(e), 'error') },
                )
              }
            >
              {t.admin.reject}
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function AdminLog() {
  const t = useT();
  const q = useModerationLog();
  if (q.isPending) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data.length) return <EmptyState icon={ScrollText} title={t.admin.noItems} />;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="text-text-2 text-xs">
          <tr>
            <th className="px-4 py-2.5 font-semibold">Когда</th>
            <th className="px-4 py-2.5 font-semibold">Кто</th>
            <th className="px-4 py-2.5 font-semibold">Действие</th>
            <th className="px-4 py-2.5 font-semibold">Пользователь</th>
            <th className="px-4 py-2.5 font-semibold">Причина</th>
          </tr>
        </thead>
        <tbody className="divide-line divide-y">
          {q.data.map((a) => (
            <tr key={a.id}>
              <td className="px-4 py-2.5 whitespace-nowrap">{relativeTime(a.created_at)}</td>
              <td className="px-4 py-2.5">{a.moderator_name}</td>
              <td className="px-4 py-2.5 font-mono text-xs">{a.action}</td>
              <td className="px-4 py-2.5">{a.target_name}</td>
              <td className="max-w-xs px-4 py-2.5 break-words">{a.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AdminSection({ children }: { children: ReactNode }) {
  return <div className="space-y-4">{children}</div>;
}
