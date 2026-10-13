import { ArrowLeftRight, BadgeCheck, Gift, MessageCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useStartConversation } from '@/api/chat';
import {
  useCreateClaim,
  useCreateOffer,
  useCreateRequest,
  useInteractionAction,
  useListingInteractions,
  useQueuePosition,
} from '@/api/interactions';
import { useMyListings, type Listing } from '@/api/listings';
import { Counter, InlineError, Modal, Spinner } from '@/components/ui';
import { useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';

export function VisitorActions({ listing }: { listing: Listing }) {
  const t = useT();
  const { user } = useAuth();
  const loc = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const start = useStartConversation();
  const inter = useListingInteractions(listing.id, true);
  const action = useInteractionAction();
  const [dialog, setDialog] = useState<'request' | 'offer' | 'claim' | null>(null);

  const open = listing.status === 'active' || listing.status === 'reserved';
  const myRequest = inter.data?.requests.find((r) => ['pending', 'approved'].includes(r.status));
  const myOffer = inter.data?.offers.find((o) => ['pending', 'accepted'].includes(o.status));
  const myClaim = inter.data?.claims.find((c) => ['pending', 'approved'].includes(c.status));
  const queue = useQueuePosition(myRequest?.id);

  if (!user) {
    return (
      <Link to={`/login?next=${encodeURIComponent(loc.pathname)}`} className="btn-cta w-full">
        <MessageCircle className="size-5" aria-hidden />
        {t.auth.loginRequired}
      </Link>
    );
  }
  if (!open) return null;

  const write = () =>
    start.mutate(
      { listingId: listing.id },
      {
        onSuccess: (id) => navigate(`/chats/${id}`),
        onError: (e) => toast(errorMessage(e), 'error'),
      },
    );
  const act = (kind: 'request' | 'offer' | 'claim', id: string, a: string) =>
    action.mutate(
      { kind, id, action: a, listingId: listing.id },
      { onError: (e) => toast(errorMessage(e), 'error') },
    );

  const needsClaimFirst = listing.type === 'found' && listing.is_valuable && !myClaim;

  return (
    <div className="flex flex-col gap-3">
      {listing.type === 'giveaway' &&
        (myRequest ? (
          <div className="bg-primary-soft text-primary-ink rounded-2xl p-4">
            <p className="font-bold">
              {myRequest.status === 'approved' ? t.activity.status.approved : t.listing.requestSent}
            </p>
            {queue.data != null && (
              <p className="mt-0.5 text-sm">
                {t.listing.queuePosition}: {queue.data}
              </p>
            )}
            <button
              type="button"
              className="btn-ghost mt-2 -ml-3 min-h-10 text-sm"
              disabled={action.isPending}
              onClick={() => act('request', myRequest.id, 'cancel')}
            >
              {t.listing.cancelRequest}
            </button>
          </div>
        ) : (
          listing.status === 'active' && (
            <button type="button" className="btn-cta w-full" onClick={() => setDialog('request')}>
              <Gift className="size-5" aria-hidden />
              {t.listing.requestItem}
            </button>
          )
        ))}

      {listing.type === 'exchange' &&
        (myOffer ? (
          <div className="bg-info-soft text-info rounded-2xl p-4">
            <p className="font-bold">{t.activity.status[myOffer.status]}</p>
            {myOffer.status === 'accepted' && (
              <p className="mt-0.5 text-sm">
                {myOffer.offerer_confirmed_at ? t.listing.waitingOther : t.listing.contactHint}
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {myOffer.status === 'accepted' && !myOffer.offerer_confirmed_at && (
                <button
                  type="button"
                  className="btn-primary min-h-10"
                  onClick={() => act('offer', myOffer.id, 'confirm')}
                >
                  {t.listing.confirmExchange}
                </button>
              )}
              <button
                type="button"
                className="btn-ghost min-h-10 text-sm"
                onClick={() => act('offer', myOffer.id, 'cancel')}
              >
                {t.common.cancel}
              </button>
            </div>
          </div>
        ) : (
          listing.status === 'active' && (
            <button type="button" className="btn-cta w-full" onClick={() => setDialog('offer')}>
              <ArrowLeftRight className="size-5" aria-hidden />
              {t.listing.offerExchange}
            </button>
          )
        ))}

      {listing.type === 'found' &&
        (myClaim ? (
          <div className="bg-primary-soft text-primary-ink rounded-2xl p-4">
            <p className="font-bold">
              {myClaim.status === 'approved' ? t.activity.status.approved : t.listing.claimSent}
            </p>
            <button
              type="button"
              className="btn-ghost mt-2 -ml-3 min-h-10 text-sm"
              onClick={() => act('claim', myClaim.id, 'cancel')}
            >
              {t.common.cancel}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={`${listing.is_valuable ? 'btn-cta' : 'btn-secondary'} w-full ${listing.is_valuable ? '' : 'order-2'}`}
            onClick={() => setDialog('claim')}
          >
            <BadgeCheck className="size-5" aria-hidden />
            {t.listing.claimItem}
          </button>
        ))}

      {!needsClaimFirst && (
        <button
          type="button"
          className={
            listing.type === 'lost' ||
            listing.type === 'wanted' ||
            (listing.type === 'found' && !listing.is_valuable && !myClaim)
              ? 'btn-cta w-full'
              : 'btn-secondary w-full'
          }
          onClick={write}
          disabled={start.isPending}
        >
          {start.isPending ? (
            <Spinner className="size-5" />
          ) : (
            <MessageCircle className="size-5" aria-hidden />
          )}
          {t.listing.write}
        </button>
      )}

      {dialog === 'request' && <RequestDialog listingId={listing.id} onClose={() => setDialog(null)} />}
      {dialog === 'offer' && <OfferDialog listingId={listing.id} onClose={() => setDialog(null)} />}
      {dialog === 'claim' && <ClaimDialog listingId={listing.id} onClose={() => setDialog(null)} />}
    </div>
  );
}

function TextDialog({
  title,
  label,
  placeholder,
  hint,
  min,
  max,
  submitLabel,
  pending,
  error,
  onSubmit,
  onClose,
  extra,
}: {
  title: string;
  label: string;
  placeholder: string;
  hint?: string;
  min: number;
  max: number;
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: (text: string) => void;
  onClose: () => void;
  extra?: ReactNode;
}) {
  const t = useT();
  const [text, setText] = useState('');
  const valid = text.trim().length >= min && text.length <= max;
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t.common.cancel}
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!valid || pending}
            onClick={() => !pending && onSubmit(text.trim())}
          >
            {pending && <Spinner className="size-4" />}
            {submitLabel}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-end justify-between">
          <label htmlFor="dlg-text" className="field-label">
            {label}
          </label>
          <Counter value={text.length} max={max} />
        </div>
        <textarea
          id="dlg-text"
          rows={4}
          maxLength={max}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          className="field-input resize-y"
        />
        {hint && <p className="field-hint">{hint}</p>}
        {extra}
        <InlineError error={error} />
      </div>
    </Modal>
  );
}

function RequestDialog({ listingId, onClose }: { listingId: string; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const m = useCreateRequest();
  return (
    <TextDialog
      title={t.listing.requestItem}
      label={t.listing.requestMessage}
      placeholder={t.listing.requestMessagePlaceholder}
      min={0}
      max={500}
      submitLabel={t.listing.requestItem}
      pending={m.isPending}
      error={m.error}
      onClose={onClose}
      onSubmit={(message) =>
        m.mutate(
          { listing_id: listingId, message },
          { onSuccess: () => (toast(t.listing.requestSent), onClose()) },
        )
      }
    />
  );
}

function OfferDialog({ listingId, onClose }: { listingId: string; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const m = useCreateOffer();
  const mine = useMyListings();
  const [offered, setOffered] = useState('');
  const options = (mine.data ?? []).filter(
    (l) => l.type === 'exchange' && l.status === 'active' && l.moderation_state === 'ok',
  );
  return (
    <TextDialog
      title={t.listing.offerExchange}
      label={t.listing.offerMessage}
      placeholder={t.listing.offerMessagePlaceholder}
      min={3}
      max={1000}
      submitLabel={t.listing.offerExchange}
      pending={m.isPending}
      error={m.error}
      onClose={onClose}
      extra={
        options.length > 0 && (
          <div>
            <label htmlFor="offer-listing" className="field-label">
              {t.listing.offerListing}
            </label>
            <select
              id="offer-listing"
              className="field-input"
              value={offered}
              onChange={(e) => setOffered(e.target.value)}
            >
              <option value="">—</option>
              {options.map((o) => (
                <option key={o.id} value={o.id!}>
                  {o.title}
                </option>
              ))}
            </select>
          </div>
        )
      }
      onSubmit={(message) =>
        m.mutate(
          { listing_id: listingId, message, offered_listing_id: offered || null },
          { onSuccess: () => (toast(t.listing.offerSent), onClose()) },
        )
      }
    />
  );
}

function ClaimDialog({ listingId, onClose }: { listingId: string; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const m = useCreateClaim();
  return (
    <TextDialog
      title={t.listing.claimItem}
      label={t.listing.claimProof}
      placeholder={t.listing.claimProofPlaceholder}
      hint={t.listing.claimProofHint}
      min={10}
      max={1000}
      submitLabel={t.common.confirm}
      pending={m.isPending}
      error={m.error}
      onClose={onClose}
      onSubmit={(proof) =>
        m.mutate(
          { listing_id: listingId, proof },
          { onSuccess: () => (toast(t.listing.claimSent), onClose()) },
        )
      }
    />
  );
}
