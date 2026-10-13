import {
  ArrowRight,
  Gift,
  HandHeart,
  Inbox,
  PackageSearch,
  Search,
  SearchCheck,
  ShieldCheck,
  ArrowLeftRight,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useRecommended, useSearchListings } from '@/api/listings';
import { useCategories } from '@/api/reference';
import { CategoryIcon } from '@/components/CategoryIcon';
import { ListingGrid, ListingGridSkeleton } from '@/components/listing/parts';
import { EmptyState, ErrorState, Modal } from '@/components/ui';
import { localizedName, useT } from '@/i18n';
import { useCity } from '@/providers/CityProvider';

export default function HomePage() {
  const t = useT();
  const navigate = useNavigate();
  const { cityId } = useCity();
  const [q, setQ] = useState('');
  const [sheet, setSheet] = useState<'lf' | 'give' | null>(null);
  const recent = useSearchListings({ city: cityId, sort: 'new' });
  const recommended = useRecommended();
  const categories = useCategories();
  const items = recent.data?.pages[0]?.slice(0, 8) ?? [];
  const placeholder = `${t.home.searchIn} ${t.home.cityIn[cityId] ?? ''}`.trim() + '?';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    navigate(q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : '/search');
  };

  return (
    <div className="space-y-7">
      <section>
        <h1 className="text-[34px] leading-none font-extrabold tracking-[0.02em] sm:text-[42px]">TAPTIM</h1>
        <p className="text-text-2 mt-2 max-w-md text-[15px] leading-snug">{t.common.slogan}</p>

        <form onSubmit={submit} role="search" className="mt-4 max-w-2xl">
          <label htmlFor="home-search" className="sr-only">
            {t.common.search}
          </label>
          <div className="relative">
            <Search
              className="text-text-2 pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2"
              aria-hidden
            />
            <input
              id="home-search"
              type="search"
              value={q}
              maxLength={100}
              onChange={(e) => setQ(e.target.value)}
              placeholder={placeholder}
              className="field-input min-h-12 rounded-2xl pl-12"
              enterKeyHint="search"
            />
          </div>
        </form>

        {/* Two big tiles from the concept */}
        <div className="mt-4 grid max-w-2xl grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setSheet('lf')}
            className="bg-primary-deep flex min-h-[150px] flex-col rounded-[22px] p-4 text-left text-white shadow-[var(--shadow-card)] transition-transform active:scale-[0.99]"
          >
            <PackageSearch className="size-7" aria-hidden />
            <span className="mt-auto pt-6 text-[17px] leading-tight font-extrabold">
              {t.home.tileLostFound}
            </span>
            <span className="mt-1.5 text-[12.5px] leading-snug text-white/85">
              {t.home.tileLostFoundHint}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setSheet('give')}
            className="bg-primary-soft text-text flex min-h-[150px] flex-col rounded-[22px] p-4 text-left shadow-[var(--shadow-card)] transition-transform active:scale-[0.99]"
          >
            <Gift className="text-primary-ink size-7" aria-hidden />
            <span className="mt-auto pt-6 text-[17px] leading-tight font-extrabold">{t.home.tileGive}</span>
            <span className="text-text-2 mt-1.5 text-[12.5px] leading-snug">{t.home.tileGiveHint}</span>
          </button>
        </div>
      </section>

      {recommended.data && recommended.data.length > 0 && (
        <section aria-labelledby="rec-title">
          <h2 id="rec-title" className="mb-3 text-[18px] font-extrabold">
            {t.home.forYou}
          </h2>
          <ListingGrid items={recommended.data.slice(0, 4)} />
        </section>
      )}

      <section aria-labelledby="recent-title">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="recent-title" className="text-[18px] font-extrabold">
            {t.home.recent}
          </h2>
          <Link to="/search" className="text-primary-ink text-sm font-semibold hover:underline">
            {t.home.seeAll}
          </Link>
        </div>
        {recent.isPending ? (
          <ListingGridSkeleton count={4} />
        ) : recent.isError ? (
          <ErrorState error={recent.error} onRetry={() => recent.refetch()} />
        ) : items.length ? (
          <ListingGrid items={items} />
        ) : (
          <EmptyState
            icon={Inbox}
            title={t.feed.emptyFeed}
            text={t.home.emptyRecent}
            action={
              <Link to="/new" className="btn-primary">
                {t.feed.createHere}
              </Link>
            }
          />
        )}
      </section>

      <section aria-labelledby="cat-title">
        <h2 id="cat-title" className="mb-3 text-[18px] font-extrabold">
          {t.home.categories}
        </h2>
        <div className="flex flex-wrap gap-2">
          {(categories.data ?? []).map((c) => (
            <Link key={c.id} to={`/search?category=${c.id}`} className="chip">
              <CategoryIcon name={c.icon} className="text-primary-ink size-4" />
              {localizedName(c)}
            </Link>
          ))}
          {categories.isPending &&
            Array.from({ length: 8 }, (_, i) => <span key={i} className="skeleton h-9 w-28 rounded-full" />)}
        </div>
      </section>

      <Link to="/safety" className="card flex items-center gap-4 p-4 transition-shadow hover:shadow-md">
        <span className="bg-primary-soft text-primary-ink flex size-11 shrink-0 items-center justify-center rounded-full">
          <ShieldCheck className="size-6" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold">{t.home.safetyTitle}</span>
          <span className="text-text-2 mt-0.5 block text-sm">{t.home.safetyText}</span>
        </span>
        <ArrowRight className="text-text-2 size-5 shrink-0" aria-hidden />
      </Link>

      <Modal open={sheet === 'lf'} onClose={() => setSheet(null)} title={t.home.lostOrFoundTitle}>
        <ActionList
          items={[
            { to: '/new?type=lost', icon: PackageSearch, label: t.home.iLost, hint: t.types.lost.hint },
            { to: '/new?type=found', icon: HandHeart, label: t.home.iFound, hint: t.types.found.hint },
          ]}
          links={[
            { to: '/lost', label: t.home.browseLost },
            { to: '/found', label: t.home.browseFound },
          ]}
        />
      </Modal>
      <Modal open={sheet === 'give'} onClose={() => setSheet(null)} title={t.home.tileGive}>
        <ActionList
          items={[
            {
              to: '/new?type=giveaway',
              icon: Gift,
              label: t.types.giveaway.action,
              hint: t.types.giveaway.hint,
            },
            {
              to: '/new?type=exchange',
              icon: ArrowLeftRight,
              label: t.types.exchange.action,
              hint: t.types.exchange.hint,
            },
            {
              to: '/new?type=wanted',
              icon: SearchCheck,
              label: t.types.wanted.action,
              hint: t.types.wanted.hint,
            },
          ]}
          links={[
            { to: '/free', label: t.hubs.tabGive },
            { to: '/exchange', label: t.hubs.tabExchange },
            { to: '/wanted', label: t.hubs.tabWanted },
          ]}
        />
      </Modal>
    </div>
  );
}

function ActionList({
  items,
  links,
}: {
  items: { to: string; icon: typeof Gift; label: string; hint: string }[];
  links: { to: string; label: string }[];
}) {
  const t = useT();
  return (
    <div className="space-y-4 pb-2">
      <div className="grid gap-2.5">
        {items.map((a) => (
          <Link key={a.to} to={a.to} className="card flex items-center gap-3.5 p-4 hover:shadow-md">
            <span className="bg-primary-soft text-primary-ink flex size-11 shrink-0 items-center justify-center rounded-full">
              <a.icon className="size-6" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block font-bold">{a.label}</span>
              <span className="text-text-2 block text-sm">{a.hint}</span>
            </span>
          </Link>
        ))}
      </div>
      <div>
        <p className="text-text-2 mb-2 text-sm font-semibold">{t.home.seeAll}</p>
        <div className="flex flex-wrap gap-2">
          {links.map((l) => (
            <Link key={l.to} to={l.to} className="chip">
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
