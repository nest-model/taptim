import {
  Calendar,
  ChevronLeft,
  Clock,
  FileWarning,
  Gem,
  MapPin,
  Share2,
  ShieldCheck,
  Tag,
  Wallet,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { useListing, useSimilarListings } from '@/api/listings';
import { byId, useCategories, useDistricts } from '@/api/reference';
import { ReportButton } from '@/components/ReportDialog';
import { Gallery } from '@/components/listing/Gallery';
import { OwnerPanel } from '@/components/listing/OwnerPanel';
import { cardTitle, FavoriteButton, StatusBadge, TypeBadge } from '@/components/listing/parts';
import { VisitorActions } from '@/components/listing/VisitorActions';
import { CategoryIcon } from '@/components/CategoryIcon';
import { Avatar, EmptyState, ErrorState, Notice, PageLoader } from '@/components/ui';
import { localizedName, useT } from '@/i18n';
import { formatDate, formatSinceMonth, isExpired, relativeTime } from '@/lib/format';
import { publicUrl } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { useMediaQuery } from '@/hooks/useMediaQuery';

export default function ListingPage() {
  const { id } = useParams();
  const t = useT();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const q = useListing(id);
  const categories = useCategories();
  const districts = useDistricts(q.data?.listing.city_id ?? 'shymkent');
  const similar = useSimilarListings(q.data?.listing);
  const wide = useMediaQuery('(min-width: 1024px)');

  if (q.isPending) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data)
    return (
      <EmptyState
        icon={FileWarning}
        title={t.common.notFoundTitle}
        text={t.common.notFoundText}
        action={
          <Link to="/" className="btn-primary">
            {t.common.toHome}
          </Link>
        }
      />
    );

  const { listing: l, photos, author } = q.data;
  const isOwner = user?.id === l.author_id;
  const cat = byId(categories.data).get(l.category_id ?? '');
  const district = byId(districts.data).get(l.district_id ?? '');
  const expired = isExpired(l.expires_at);

  const facts: { icon: typeof Tag; label: string; value: string }[] = [];
  if (cat) facts.push({ icon: Tag, label: t.feed.category, value: localizedName(cat) });
  if (l.place_hint) facts.push({ icon: MapPin, label: t.listing.place, value: l.place_hint });
  if (l.event_date)
    facts.push({
      icon: Calendar,
      label: l.type === 'lost' ? t.listing.lostOn : t.listing.foundOn,
      value: formatDate(l.event_date),
    });
  if (l.item_condition)
    facts.push({ icon: Tag, label: t.listing.condition, value: t.condition[l.item_condition] });
  if (l.type === 'giveaway' && l.quantity && l.quantity > 1)
    facts.push({
      icon: Tag,
      label: t.listing.available,
      value: `${l.quantity_available} ${t.listing.of} ${l.quantity}`,
    });
  if (l.wanted_until)
    facts.push({ icon: Calendar, label: t.listing.actualUntil, value: formatDate(l.wanted_until) });

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: l.title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast(t.common.copied);
      }
    } catch {
      /* user cancelled */
    }
  };

  const overlay = (
    <>
      <button
        type="button"
        onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
        className="bg-surface/95 text-text absolute top-3 left-3 flex size-10 items-center justify-center rounded-full shadow-sm"
        aria-label={t.common.back}
      >
        <ChevronLeft className="size-6" />
      </button>
      {!isOwner && <FavoriteButton id={l.id} className="absolute top-3 right-3" />}
      <div className="absolute bottom-3 left-3 flex gap-1.5">
        <TypeBadge type={l.type} className="px-2.5 py-1 text-[13px] shadow-sm" />
        <StatusBadge
          status={l.status}
          type={l.type}
          expired={expired}
          moderation={l.moderation_state === 'ok' ? null : l.moderation_state}
        />
      </div>
    </>
  );

  return (
    <article className="mx-auto max-w-5xl">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-8">
        <div className="min-w-0 space-y-4">
          <Gallery photos={photos} title={l.title} icon={cat?.icon} overlay={overlay} />

          <div className="pt-1">
            <h1 className="text-[26px] leading-tight font-extrabold break-words sm:text-[30px]">
              {l.title || '—'}
            </h1>
            <div className="text-text-2 mt-2 space-y-1 text-[15px]">
              <p className="flex items-center gap-2">
                <MapPin className="size-4 shrink-0" aria-hidden />
                {localizedName(district) || t.common.district}
              </p>
              <p className="flex items-center gap-2">
                <Clock className="size-4 shrink-0" aria-hidden />
                {relativeTime(l.published_at ?? l.created_at)}
              </p>
            </div>
          </div>

          {/* User content is rendered as plain text only (React escapes it). */}
          <p className="user-text text-text text-[16px] leading-relaxed">{l.description}</p>

          {l.type === 'exchange' && l.exchange_wish && (
            <div className="bg-primary-soft rounded-2xl p-4">
              <p className="text-primary-ink text-xs font-bold">{t.listing.wish}</p>
              <p className="user-text text-text mt-1 text-[15px]">{l.exchange_wish}</p>
            </div>
          )}

          {cat?.id === 'documents' && (
            <Notice icon={FileWarning} tone="warning">
              {l.type === 'lost' ? t.listing.lostDocumentsNotice : t.listing.documentsNotice}
            </Notice>
          )}
          {cat?.id === 'wallets' && (
            <Notice icon={Wallet} tone="warning">
              {t.listing.walletNotice}
            </Notice>
          )}
          {l.is_valuable && <Notice icon={Gem}>{t.listing.valuableNotice}</Notice>}

          {/* Main action stays right under the description on phones, as in the concept */}
          {!wide && (isOwner ? <OwnerPanel listing={l} /> : <VisitorActions listing={l} />)}

          {facts.length > 0 && (
            <dl className="bg-surface-2 grid gap-x-4 gap-y-3 rounded-2xl p-4 sm:grid-cols-2">
              {facts.map((f) => (
                <div key={f.label + f.value} className="min-w-0">
                  <dt className="text-text-2 text-xs font-semibold">{f.label}</dt>
                  <dd className="text-[15px] font-semibold break-words">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {similar.data && similar.data.length > 0 && (
            <section aria-labelledby="similar-title" className="pt-2">
              <h2 id="similar-title" className="mb-3 text-[17px] font-extrabold">
                {t.listing.similar}
              </h2>
              <ul className="no-scrollbar -mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0">
                {similar.data.map((s) => {
                  const cover = publicUrl('listing-photos', s.cover_path);
                  const sc = byId(categories.data).get(s.category_id ?? '');
                  return (
                    <li key={s.id} className="w-[132px] shrink-0">
                      <Link to={`/listing/${s.id}`} className="block">
                        {cover ? (
                          <img
                            src={cover}
                            alt=""
                            loading="lazy"
                            className="aspect-square w-full rounded-xl object-cover"
                          />
                        ) : (
                          <div className="bg-primary-soft text-primary-ink flex aspect-square w-full items-center justify-center rounded-xl">
                            <CategoryIcon name={sc?.icon} className="size-8 opacity-70" />
                          </div>
                        )}
                        <p className="mt-1.5 line-clamp-2 text-[13px] leading-snug font-semibold break-words">
                          {cardTitle(s)}
                        </p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          {wide && (isOwner ? <OwnerPanel listing={l} /> : <VisitorActions listing={l} />)}

          {author && (
            <Link
              to={`/u/${author.id}`}
              className="card flex items-center gap-3 p-4 transition-shadow hover:shadow-md"
            >
              <Avatar path={author.avatar_path} name={author.display_name} size={48} />
              <div className="min-w-0">
                <p className="text-text-2 text-xs font-semibold">{t.listing.author}</p>
                <p className="truncate font-bold">
                  {author.is_deleted ? t.common.deletedUser : author.display_name}
                </p>
                <p className="text-text-2 text-xs">
                  {t.listing.memberSince} {formatSinceMonth(author.created_at)}
                </p>
              </div>
            </Link>
          )}

          <div className="flex flex-wrap items-center gap-1">
            <button type="button" className="btn-ghost text-text-2" onClick={share}>
              <Share2 className="size-4" aria-hidden />
              {t.common.share}
            </button>
            {!isOwner && <ReportButton target={{ target_type: 'listing', listing_id: l.id }} />}
          </div>

          <Link to="/safety" className="bg-surface-2 flex items-start gap-3 rounded-2xl p-4 text-sm">
            <ShieldCheck className="text-primary-ink size-5 shrink-0" aria-hidden />
            <span className="text-text-2">{t.listing.contactHint}</span>
          </Link>
        </aside>
      </div>
    </article>
  );
}
