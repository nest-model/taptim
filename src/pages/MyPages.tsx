import { ArrowLeftRight, Bell, Flag, Heart, LayoutList } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMarkNotificationsRead, useMyReports, useNotifications, useReplyToReport } from '@/api/account';
import { useMyActivity } from '@/api/interactions';
import { useFavorites, useMyListings } from '@/api/listings';
import { ListingGrid, ListingGridSkeleton } from '@/components/listing/parts';
import { EmptyState, ErrorState, InlineError, Modal, PageHeader, Spinner } from '@/components/ui';
import { useT } from '@/i18n';
import { relativeTime } from '@/lib/format';
import { safeInternalPath } from '@/lib/safe-link';
import { useToast } from '@/providers/ToastProvider';

type Tab = 'active' | 'drafts' | 'closed';

export function MyListingsPage() {
  const t = useT();
  const q = useMyListings();
  const [tab, setTab] = useState<Tab>('active');
  const items = (q.data ?? []).filter((l) =>
    tab === 'drafts'
      ? l.status === 'draft'
      : tab === 'active'
        ? ['active', 'reserved'].includes(l.status!)
        : ['resolved', 'archived'].includes(l.status!),
  );
  const tabs: [Tab, string][] = [
    ['active', t.myListings.tabActive],
    ['drafts', t.myListings.tabDrafts],
    ['closed', t.myListings.tabClosed],
  ];
  return (
    <div>
      <PageHeader title={t.myListings.title} back="/me" />
      <div className="segment mb-4 max-w-md" role="tablist">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className="segment-item gap-1.5"
            onClick={() => setTab(k)}
          >
            {label}
            <span className="opacity-70">
              {
                (q.data ?? []).filter((l) =>
                  k === 'drafts'
                    ? l.status === 'draft'
                    : k === 'active'
                      ? ['active', 'reserved'].includes(l.status!)
                      : ['resolved', 'archived'].includes(l.status!),
                ).length
              }
            </span>
          </button>
        ))}
      </div>
      {q.isPending ? (
        <ListingGridSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : items.length ? (
        <ListingGrid items={items} />
      ) : (
        <EmptyState
          icon={LayoutList}
          title={t.myListings.empty}
          action={
            <Link to="/new" className="btn-primary">
              {t.feed.createHere}
            </Link>
          }
        />
      )}
    </div>
  );
}

export function FavoritesPage() {
  const t = useT();
  const q = useFavorites();
  return (
    <div>
      <PageHeader title={t.favorites.title} />
      {q.isPending ? (
        <ListingGridSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.length ? (
        <ListingGrid items={q.data} />
      ) : (
        <EmptyState icon={Heart} title={t.favorites.title} text={t.favorites.empty} />
      )}
    </div>
  );
}

export function NotificationsPage() {
  const t = useT();
  const q = useNotifications();
  const mark = useMarkNotificationsRead();
  const navigate = useNavigate();
  const unread = q.data?.filter((n) => !n.is_read).length ?? 0;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={t.notifications.title}
        action={
          unread > 0 && (
            <button
              type="button"
              className="btn-ghost text-sm"
              onClick={() => mark.mutate('all')}
              disabled={mark.isPending}
            >
              {t.notifications.markAll}
            </button>
          )
        }
      />
      {q.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="skeleton h-[72px] rounded-2xl" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data.length ? (
        <EmptyState icon={Bell} title={t.notifications.empty} />
      ) : (
        <ul className="card divide-line divide-y overflow-hidden">
          {q.data.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => {
                  if (!n.is_read) mark.mutate([n.id]);
                  // links come from the DB but are still validated as in-app paths
                  if (n.link) navigate(safeInternalPath(n.link));
                }}
                className="hover:bg-surface-2 flex w-full items-start gap-3 px-4 py-3.5 text-left"
              >
                <span
                  className={`mt-1.5 size-2.5 shrink-0 rounded-full ${n.is_read ? 'bg-transparent' : 'bg-primary'}`}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className={`block ${n.is_read ? 'font-medium' : 'font-bold'}`}>{n.title}</span>
                  {n.body && <span className="text-text-2 block text-sm break-words">{n.body}</span>}
                  <span className="text-text-2 mt-0.5 block text-xs">{relativeTime(n.created_at)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ActivityPage() {
  const t = useT();
  const q = useMyActivity();
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const sections = [
    { title: t.activity.myRequests, rows: q.data?.requests ?? [] },
    { title: t.activity.myOffers, rows: q.data?.offers ?? [] },
    { title: t.activity.myClaims, rows: q.data?.claims ?? [] },
  ];
  const empty = q.data && sections.every((s) => !s.rows.length);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t.activity.title} back="/me" />
      {q.isPending ? (
        <div className="skeleton h-40 rounded-2xl" />
      ) : empty ? (
        <EmptyState icon={ArrowLeftRight} title={t.activity.empty} />
      ) : (
        <div className="space-y-6">
          {sections
            .filter((s) => s.rows.length)
            .map((s) => (
              <section key={s.title}>
                <h2 className="mb-2 font-extrabold">{s.title}</h2>
                <ul className="card divide-line divide-y overflow-hidden">
                  {s.rows.map((r) => (
                    <li key={r.id}>
                      <Link
                        to={`/listing/${r.listing_id}`}
                        className="hover:bg-surface-2 flex items-center gap-3 px-4 py-3"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">
                            {q.data?.titles.get(r.listing_id) ?? '—'}
                          </span>
                          <span className="text-text-2 text-xs">{relativeTime(r.created_at)}</span>
                        </span>
                        <span className="bg-surface-2 shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold">
                          {t.activity.status[r.status as keyof typeof t.activity.status]}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}
    </div>
  );
}

export function MyReportsPage() {
  const t = useT();
  const q = useMyReports();
  const [replyFor, setReplyFor] = useState<string | null>(null);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t.reports.myTitle} back="/me" />
      {q.isPending ? (
        <div className="skeleton h-40 rounded-2xl" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data.length ? (
        <EmptyState icon={Flag} title={t.reports.empty} />
      ) : (
        <ul className="space-y-2">
          {q.data.map((r) => (
            <li key={r.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{t.reports.reasons[r.reason]}</span>
                <span className="text-text-2 text-sm">· {t.reports.targets[r.target_type]}</span>
                <span className="bg-surface-2 ml-auto rounded-full px-2.5 py-1 text-xs font-semibold">
                  {t.reports.status[r.status]}
                </span>
              </div>
              {r.description && <p className="user-text text-text-2 mt-1.5 text-sm">{r.description}</p>}
              <p className="text-text-2 mt-1 text-xs">{relativeTime(r.created_at)}</p>
              {r.status === 'needs_info' && (
                <div className="bg-warning-soft text-warning mt-3 rounded-xl p-3 text-sm">
                  <p className="user-text">{r.info_request}</p>
                  <button
                    type="button"
                    className="mt-1 font-semibold underline"
                    onClick={() => setReplyFor(r.id)}
                  >
                    {t.reports.reply}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {replyFor && <ReplyDialog id={replyFor} onClose={() => setReplyFor(null)} />}
    </div>
  );
}

function ReplyDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const m = useReplyToReport();
  const [text, setText] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title={t.reports.reply}
      footer={
        <button
          type="button"
          className="btn-primary"
          disabled={text.trim().length < 3 || m.isPending}
          onClick={() =>
            m.mutate({ id, text: text.trim() }, { onSuccess: () => (toast(t.reports.replySent), onClose()) })
          }
        >
          {m.isPending && <Spinner className="size-4" />}
          {t.common.confirm}
        </button>
      }
    >
      <textarea
        aria-label={t.reports.reply}
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
