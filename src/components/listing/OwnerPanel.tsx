import {
  Archive,
  CircleCheck,
  Clock,
  Eye,
  MessageCircle,
  Pencil,
  RotateCcw,
  ShieldAlert,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useCreateAppeal, useMyAppeals } from '@/api/account';
import { useStartConversation } from '@/api/chat';
import { useInteractionAction, useListingInteractions } from '@/api/interactions';
import {
  useDeleteListing,
  useListingMatches,
  useRepublish,
  useUpdateListing,
  type Listing,
} from '@/api/listings';
import { ConfirmDialog, Counter, InlineError, Modal, Notice, Spinner } from '@/components/ui';
import { useT } from '@/i18n';
import { daysLeft, isExpired, plural, relativeTime } from '@/lib/format';
import { errorMessage } from '@/lib/errors';
import { useToast } from '@/providers/ToastProvider';
import { ListingGrid } from './parts';

export function OwnerPanel({ listing }: { listing: Listing }) {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const update = useUpdateListing();
  const republish = useRepublish();
  const del = useDeleteListing();
  const [confirm, setConfirm] = useState<'delete' | 'resolve' | null>(null);
  const [appealOpen, setAppealOpen] = useState(false);
  const appeals = useMyAppeals();
  const matches = useListingMatches(listing, true);

  const expired = isExpired(listing.expires_at);
  const left = daysLeft(listing.expires_at);
  const busy = update.isPending || republish.isPending || del.isPending;
  const hasOpenAppeal = appeals.data?.some((a) => a.listing_id === listing.id && a.status === 'new');

  const setStatus = (status: Listing['status']) =>
    update.mutate(
      { id: listing.id, values: { status } },
      { onSuccess: () => toast(t.common.saved), onError: (e) => toast(errorMessage(e), 'error') },
    );

  return (
    <section className="card space-y-4 p-4" aria-label={t.listing.myListing}>
      <p className="text-text-2 text-sm font-bold">{t.listing.myListing}</p>

      {listing.moderation_state === 'pending_review' && (
        <Notice icon={Clock} tone="warning">
          {t.moderation.pendingHint}
        </Notice>
      )}
      {listing.moderation_state === 'hidden' && (
        <Notice icon={ShieldAlert} tone="warning">
          <p>{t.moderation.hiddenHint}</p>
          {hasOpenAppeal ? (
            <p className="mt-2 font-semibold">{t.listing.appealSent}</p>
          ) : (
            <button
              type="button"
              className="mt-2 font-semibold underline"
              onClick={() => setAppealOpen(true)}
            >
              {t.listing.appeal}
            </button>
          )}
        </Notice>
      )}
      {expired && listing.status === 'active' && <Notice icon={Clock}>{t.listing.expiredNotice}</Notice>}
      {!expired && left != null && left <= 30 && ['active', 'reserved'].includes(listing.status) && (
        <p className="text-text-2 text-sm">
          {t.listing.expiresIn} {left} {plural(left, 'день', 'дня', 'дней')}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {listing.status !== 'resolved' && (
          <Link to={`/listing/${listing.id}/edit`} className="btn-secondary">
            <Pencil className="size-4" aria-hidden />
            {t.common.edit}
          </Link>
        )}
        {listing.status === 'draft' && (
          <button type="button" className="btn-primary" disabled={busy} onClick={() => setStatus('active')}>
            {t.listing.publishDraft}
          </button>
        )}
        {listing.status === 'active' && !expired && (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => setStatus('reserved')}
          >
            <Eye className="size-4" aria-hidden />
            {t.listing.markReserved}
          </button>
        )}
        {listing.status === 'reserved' && (
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => setStatus('active')}>
            <Undo2 className="size-4" aria-hidden />
            {t.listing.markActive}
          </button>
        )}
        {['active', 'reserved'].includes(listing.status) && (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => setConfirm('resolve')}
          >
            <CircleCheck className="size-4" aria-hidden />
            {t.types[listing.type].resolved}
          </button>
        )}
        {(listing.status === 'archived' || (listing.status === 'active' && expired)) &&
          listing.moderation_state !== 'hidden' && (
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() =>
                republish.mutate(listing.id, {
                  onSuccess: () => toast(t.common.saved),
                  onError: (e) => toast(errorMessage(e), 'error'),
                })
              }
            >
              <RotateCcw className="size-4" aria-hidden />
              {t.listing.republish}
            </button>
          )}
        {['active', 'reserved', 'resolved'].includes(listing.status) && (
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => setStatus('archived')}>
            <Archive className="size-4" aria-hidden />
            {t.listing.archive}
          </button>
        )}
        <button
          type="button"
          className="btn-ghost text-danger"
          disabled={busy}
          onClick={() => setConfirm('delete')}
        >
          <Trash2 className="size-4" aria-hidden />
          {t.common.delete}
        </button>
      </div>

      <Interactions listing={listing} />

      {matches.data && matches.data.length > 0 && (
        <div>
          <h3 className="font-bold">{t.listing.matches}</h3>
          <p className="text-text-2 mb-3 text-sm">{t.listing.matchesHint}</p>
          <ListingGrid items={matches.data} />
        </div>
      )}

      <ConfirmDialog
        open={confirm === 'delete'}
        title={t.common.delete}
        text={t.listing.deleteConfirm}
        confirmLabel={t.common.delete}
        danger
        pending={del.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={() =>
          del.mutate(listing, {
            onSuccess: () => {
              toast(t.listing.deleted);
              navigate('/me/listings', { replace: true });
            },
            onError: (e) => toast(errorMessage(e), 'error'),
          })
        }
      />
      <ConfirmDialog
        open={confirm === 'resolve'}
        title={t.types[listing.type].resolved}
        text={t.listing.resolveConfirm}
        confirmLabel={t.common.confirm}
        pending={update.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          setStatus('resolved');
          setConfirm(null);
        }}
      />
      {appealOpen && <AppealDialog listingId={listing.id} onClose={() => setAppealOpen(false)} />}
    </section>
  );
}

function AppealDialog({ listingId, onClose }: { listingId: string; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const m = useCreateAppeal();
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
              { listing_id: listingId, message: text.trim() },
              { onSuccess: () => (toast(t.listing.appealSent), onClose()) },
            )
          }
        >
          {m.isPending && <Spinner className="size-4" />}
          {t.common.confirm}
        </button>
      }
    >
      <div className="space-y-2">
        <div className="flex justify-end">
          <Counter value={text.length} max={1000} />
        </div>
        <textarea
          aria-label={t.listing.appeal}
          rows={4}
          maxLength={1000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t.listing.appealPlaceholder}
          className="field-input"
        />
        <InlineError error={m.error} />
      </div>
    </Modal>
  );
}

function Interactions({ listing }: { listing: Listing }) {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const inter = useListingInteractions(listing.id, ['giveaway', 'exchange', 'found'].includes(listing.type));
  const action = useInteractionAction();
  const start = useStartConversation();

  if (!['giveaway', 'exchange', 'found'].includes(listing.type)) return null;
  const kind = listing.type === 'giveaway' ? 'request' : listing.type === 'exchange' ? 'offer' : 'claim';
  const title =
    kind === 'request' ? t.listing.requests : kind === 'offer' ? t.listing.offers : t.listing.claims;
  const rows =
    kind === 'request'
      ? (inter.data?.requests ?? []).map((r) => ({
          id: r.id,
          party: r.requester_id,
          name: r.party_name,
          deleted: r.party_deleted,
          text: r.message,
          status: r.status,
          created: r.created_at,
          confirmed: false,
        }))
      : kind === 'offer'
        ? (inter.data?.offers ?? []).map((o) => ({
            id: o.id,
            party: o.offerer_id,
            name: o.party_name,
            deleted: o.party_deleted,
            text: o.message,
            status: o.status,
            created: o.created_at,
            confirmed: Boolean(o.author_confirmed_at),
          }))
        : (inter.data?.claims ?? []).map((c) => ({
            id: c.id,
            party: c.claimant_id,
            name: c.party_name,
            deleted: c.party_deleted,
            text: c.proof,
            status: c.status,
            created: c.created_at,
            confirmed: false,
          }));
  const visible = rows.filter((r) => !['cancelled'].includes(r.status));

  const act = (id: string, a: string) =>
    action.mutate(
      { kind, id, action: a, listingId: listing.id },
      { onError: (e) => toast(errorMessage(e), 'error') },
    );

  return (
    <div>
      <h3 className="mb-2 font-bold">{title}</h3>
      {inter.isPending ? (
        <div className="skeleton h-16" />
      ) : visible.length === 0 ? (
        <p className="text-text-2 text-sm">{t.listing.noRequests}</p>
      ) : (
        <ol className="space-y-2">
          {visible.map((r, i) => (
            <li key={r.id} className="border-line rounded-2xl border p-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {kind === 'request' && ['pending', 'approved'].includes(r.status) && (
                  <span className="text-text-2 text-sm font-bold">#{i + 1}</span>
                )}
                <span className="font-semibold break-words">{r.deleted ? t.common.deletedUser : r.name}</span>
                <span className="text-text-2 text-xs">{relativeTime(r.created)}</span>
                <span className="bg-surface-2 ml-auto rounded-full px-2 py-0.5 text-xs font-semibold">
                  {t.activity.status[r.status as keyof typeof t.activity.status]}
                </span>
              </div>
              {r.text && <p className="user-text text-text mt-1.5 text-sm">{r.text}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                {r.status === 'pending' && (
                  <>
                    <button
                      type="button"
                      className="btn-primary min-h-9 px-3 text-sm"
                      disabled={action.isPending}
                      onClick={() =>
                        act(r.id, kind === 'request' ? 'approve' : kind === 'offer' ? 'accept' : 'approve')
                      }
                    >
                      {kind === 'claim'
                        ? t.listing.approveClaim
                        : kind === 'offer'
                          ? t.listing.acceptOffer
                          : t.listing.approve}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary min-h-9 px-3 text-sm"
                      disabled={action.isPending}
                      onClick={() => act(r.id, kind === 'claim' ? 'reject' : 'decline')}
                    >
                      {kind === 'claim' ? t.listing.rejectClaim : t.listing.decline}
                    </button>
                  </>
                )}
                {['approved', 'accepted'].includes(r.status) && (
                  <>
                    {kind === 'request' && (
                      <button
                        type="button"
                        className="btn-primary min-h-9 px-3 text-sm"
                        onClick={() => act(r.id, 'complete')}
                      >
                        {t.listing.complete}
                      </button>
                    )}
                    {kind === 'claim' && (
                      <button
                        type="button"
                        className="btn-primary min-h-9 px-3 text-sm"
                        onClick={() => act(r.id, 'returned')}
                      >
                        {t.listing.returned}
                      </button>
                    )}
                    {kind === 'offer' &&
                      (r.confirmed ? (
                        <span className="text-text-2 text-sm">{t.listing.waitingOther}</span>
                      ) : (
                        <button
                          type="button"
                          className="btn-primary min-h-9 px-3 text-sm"
                          onClick={() => act(r.id, 'confirm')}
                        >
                          {t.listing.confirmExchange}
                        </button>
                      ))}
                    <button
                      type="button"
                      className="btn-ghost min-h-9 px-3 text-sm"
                      onClick={() => act(r.id, kind === 'claim' ? 'reject' : 'decline')}
                    >
                      {t.listing.decline}
                    </button>
                  </>
                )}
                {!r.deleted && ['pending', 'approved', 'accepted'].includes(r.status) && (
                  <button
                    type="button"
                    className="btn-ghost min-h-9 px-3 text-sm"
                    disabled={start.isPending}
                    onClick={() =>
                      start.mutate(
                        { listingId: listing.id, otherId: r.party },
                        {
                          onSuccess: (id) => navigate(`/chats/${id}`),
                          onError: (e) => toast(errorMessage(e), 'error'),
                        },
                      )
                    }
                  >
                    <MessageCircle className="size-4" aria-hidden />
                    {t.listing.write}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
