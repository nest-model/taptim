import { Clock, Heart, MapPin } from 'lucide-react';
import { Link } from 'react-router';
import { byId, useCategories, useDistricts } from '@/api/reference';
import { useFavoriteIds, useToggleFavorite, type ListingCard as Card } from '@/api/listings';
import { CategoryIcon } from '@/components/CategoryIcon';
import { TYPE_ICON, type ListingStatus, type ListingType } from '@/config/listing';
import { localizedName, useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { isExpired, relativeTime } from '@/lib/format';
import { publicUrl } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { useCity } from '@/providers/CityProvider';
import { useToast } from '@/providers/ToastProvider';

export function useRefMaps() {
  const { cityId } = useCity();
  const districts = useDistricts(cityId);
  const categories = useCategories();
  return { districts: byId(districts.data), categories: byId(categories.data) };
}

// Badge tones follow the concept: "Потеряно" coral, "Найдено"/"Отдам" green, "Обмен" outlined green.
const TYPE_TONE: Record<ListingType, string> = {
  lost: 'bg-danger-soft text-danger',
  found: 'bg-primary-soft text-primary-ink',
  giveaway: 'bg-primary-soft text-primary-ink',
  exchange: 'bg-surface text-primary-ink ring-1 ring-primary/50 ring-inset',
  wanted: 'bg-info-soft text-info',
};

export function TypeBadge({
  type,
  className = '',
  icon = false,
}: {
  type: ListingType;
  className?: string;
  icon?: boolean;
}) {
  const t = useT();
  const Icon = TYPE_ICON[type];
  return (
    <span className={`badge ${TYPE_TONE[type]} ${className}`}>
      {icon && <Icon className="size-3.5" aria-hidden />}
      {t.types[type].label}
    </span>
  );
}

export function StatusBadge({
  status,
  type,
  expired,
  moderation,
}: {
  status: ListingStatus;
  type: ListingType;
  expired?: boolean;
  moderation?: string | null;
}) {
  const t = useT();
  let text: string | null = null;
  let tone = 'bg-surface-2 text-text-2';
  if (moderation === 'hidden') {
    text = t.moderation.hidden;
    tone = 'bg-danger-soft text-danger';
  } else if (moderation === 'pending_review') {
    text = t.moderation.pending_review;
    tone = 'bg-warning-soft text-warning';
  } else if (status === 'resolved') {
    text = t.types[type].resolved;
  } else if (status === 'reserved') {
    text = t.listing.reservedBadge;
    tone = 'bg-info-soft text-info';
  } else if (status === 'draft' || status === 'archived') {
    text = t.status[status];
  } else if (expired) {
    text = t.status.expired;
  }
  if (!text) return null;
  return <span className={`badge ${tone}`}>{text}</span>;
}

export function FavoriteButton({ id, className = '' }: { id: string; className?: string }) {
  const { user } = useAuth();
  const t = useT();
  const favs = useFavoriteIds();
  const toggle = useToggleFavorite();
  const toast = useToast();
  if (!user) return null;
  const on = favs.data?.has(id) ?? false;
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? t.listing.unfavorite : t.listing.favorite}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle.mutate({ id, on: !on }, { onError: (err) => toast(errorMessage(err), 'error') });
      }}
      className={`bg-surface/95 hover:bg-surface flex size-10 items-center justify-center rounded-full shadow-sm transition-colors ${className}`}
    >
      <Heart className={`size-5 ${on ? 'fill-danger text-danger' : 'text-text'}`} aria-hidden />
    </button>
  );
}

/** "Клавиатура → Мышь" for exchanges, as in the concept. */
export function cardTitle(item: Pick<Card, 'type' | 'title' | 'exchange_wish'>) {
  return item.type === 'exchange' && item.exchange_wish
    ? `${item.title} → ${item.exchange_wish}`
    : (item.title ?? '');
}

function Cover({ item, className }: { item: Card; className: string }) {
  const { categories } = useRefMaps();
  const cover = publicUrl('listing-photos', item.cover_path);
  const cat = item.category_id ? categories.get(item.category_id) : undefined;
  return cover ? (
    <img src={cover} alt="" loading="lazy" decoding="async" className={`object-cover ${className}`} />
  ) : (
    <div className={`bg-primary-soft text-primary-ink flex items-center justify-center ${className}`}>
      <CategoryIcon name={cat?.icon} className="size-9 opacity-70" />
    </div>
  );
}

function Meta({ item }: { item: Card }) {
  const t = useT();
  const { districts } = useRefMaps();
  return (
    <div className="text-text-2 space-y-0.5 text-[13px]">
      <p className="flex min-w-0 items-center gap-1.5">
        <MapPin className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">
          {localizedName(districts.get(item.district_id ?? '')) || t.common.district}
        </span>
      </p>
      <p className="flex items-center gap-1.5">
        <Clock className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{relativeTime(item.published_at ?? item.created_at)}</span>
      </p>
    </div>
  );
}

function Badges({ item }: { item: Card }) {
  const type = item.type as ListingType;
  return (
    <div className="flex flex-wrap gap-1">
      <TypeBadge type={type} />
      <StatusBadge
        status={item.status as ListingStatus}
        type={type}
        expired={isExpired(item.expires_at)}
        moderation={item.moderation_state === 'ok' ? null : item.moderation_state}
      />
    </div>
  );
}

/** Grid card (home, profile): photo on top, badge under it — as in the concept's main screen. */
export function ListingCard({ item }: { item: Card }) {
  return (
    <Link
      to={`/listing/${item.id}`}
      className="group card flex w-full min-w-0 flex-col overflow-hidden transition-shadow hover:shadow-md"
    >
      <div className="relative">
        <Cover
          item={item}
          className="aspect-[4/3] w-full transition-transform duration-300 group-hover:scale-[1.02]"
        />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <Badges item={item} />
        <h3 className="text-text line-clamp-2 text-[15px] leading-snug font-bold break-words">
          {cardTitle(item)}
        </h3>
        <div className="mt-auto pt-0.5">
          <Meta item={item} />
        </div>
      </div>
    </Link>
  );
}

/** Row card (feeds, search): square thumbnail left, text right — as in the concept's feed screens. */
export function ListingRow({ item }: { item: Card }) {
  return (
    <Link
      to={`/listing/${item.id}`}
      className="card flex min-w-0 items-stretch gap-3.5 p-2.5 pr-3.5 transition-shadow hover:shadow-md"
    >
      <Cover item={item} className="size-[88px] shrink-0 rounded-xl sm:size-24" />
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 py-0.5">
        <Badges item={item} />
        <h3 className="text-text line-clamp-2 text-[15px] leading-snug font-bold break-words">
          {cardTitle(item)}
        </h3>
        <Meta item={item} />
      </div>
    </Link>
  );
}

export function ListingGrid({ items }: { items: Card[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((it) => (
        <li key={it.id} className="flex min-w-0">
          <ListingCard item={it} />
        </li>
      ))}
    </ul>
  );
}

export function ListingList({ items }: { items: Card[] }) {
  return (
    <ul className="grid gap-2.5 lg:grid-cols-2">
      {items.map((it) => (
        <li key={it.id} className="min-w-0">
          <ListingRow item={it} />
        </li>
      ))}
    </ul>
  );
}

export function ListingGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="card overflow-hidden">
          <div className="skeleton aspect-[4/3] rounded-none" />
          <div className="space-y-2 p-3">
            <div className="skeleton h-4 w-16" />
            <div className="skeleton h-4 w-4/5" />
            <div className="skeleton h-3 w-3/5" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ListingListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <ul className="grid gap-2.5 lg:grid-cols-2" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="card flex gap-3.5 p-2.5">
          <div className="skeleton size-[88px] shrink-0 rounded-xl" />
          <div className="flex-1 space-y-2 py-1">
            <div className="skeleton h-4 w-16" />
            <div className="skeleton h-4 w-3/4" />
            <div className="skeleton h-3 w-1/2" />
            <div className="skeleton h-3 w-1/3" />
          </div>
        </li>
      ))}
    </ul>
  );
}
