import { ChevronLeft, Inbox, Plus, Search, SearchX, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useSearchListings, type SearchParams } from '@/api/listings';
import { categoriesFor, useCategories } from '@/api/reference';
import { countActive, FiltersDialog, readFilters, writeFilters } from '@/components/listing/Filters';
import { ListingList, ListingListSkeleton } from '@/components/listing/parts';
import { EmptyState, ErrorState, Spinner } from '@/components/ui';
import { LISTING_TYPES, type ListingType } from '@/config/listing';
import { localizedName, useT } from '@/i18n';
import { useCity } from '@/providers/CityProvider';

const SORTS = ['new', 'relevance', 'event_date'] as const;

type Hub = 'lostfound' | 'give';
const HUB_TABS: Record<Hub, { type: ListingType; path: string }[]> = {
  lostfound: [
    { type: 'lost', path: '/lost' },
    { type: 'found', path: '/found' },
  ],
  give: [
    { type: 'giveaway', path: '/free' },
    { type: 'exchange', path: '/exchange' },
    { type: 'wanted', path: '/wanted' },
  ],
};

function useResults(fixedType: ListingType | undefined) {
  const { cityId } = useCity();
  const [sp] = useSearchParams();
  const f = readFilters(sp);
  const type =
    fixedType ?? (LISTING_TYPES.includes(f.type as ListingType) ? (f.type as ListingType) : undefined);
  const sort = SORTS.includes(f.sort as (typeof SORTS)[number])
    ? (f.sort as SearchParams['sort'])
    : undefined;
  const params: SearchParams = {
    city: cityId,
    q: f.q || undefined,
    types: type ? [type] : undefined,
    category: f.category || undefined,
    district: f.district || undefined,
    dateFrom: f.from || undefined,
    dateTo: f.to || undefined,
    includeClosed: f.closed,
    withPhoto: f.photo,
    sort,
  };
  return { results: useSearchListings(params), filters: f, type };
}

function Results({
  fixedType,
  hasFilters,
  onReset,
}: {
  fixedType?: ListingType;
  hasFilters: boolean;
  onReset: () => void;
}) {
  const t = useT();
  const { results } = useResults(fixedType);
  const items = useMemo(() => results.data?.pages.flat() ?? [], [results.data]);
  return (
    <div aria-live="polite" aria-busy={results.isFetching}>
      {results.isPending ? (
        <ListingListSkeleton />
      ) : results.isError ? (
        <ErrorState error={results.error} onRetry={() => results.refetch()} />
      ) : items.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={SearchX}
            title={t.feed.nothingFound}
            text={t.feed.nothingFoundHint}
            action={
              <button type="button" className="btn-secondary" onClick={onReset}>
                {t.feed.resetFilters}
              </button>
            }
          />
        ) : (
          <EmptyState
            icon={Inbox}
            title={t.feed.emptyFeed}
            action={
              <Link to={fixedType ? `/new?type=${fixedType}` : '/new'} className="btn-primary">
                {t.feed.createHere}
              </Link>
            }
          />
        )
      ) : (
        <>
          <ListingList items={items} />
          {results.hasNextPage && (
            <div className="mt-5 flex justify-center">
              <button
                type="button"
                className="btn-secondary"
                disabled={results.isFetchingNextPage}
                onClick={() => results.fetchNextPage()}
              >
                {results.isFetchingNextPage && <Spinner className="size-4" />}
                {t.common.showMore}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** "Потеряно / Найдено" and "Отдам / Обменяю" screens: segmented tabs + category chips + list. */
export function FeedHubPage({ hub, type }: { hub: Hub; type: ListingType }) {
  const t = useT();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const categories = useCategories();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const f = readFilters(sp);
  const tabs = HUB_TABS[hub];
  const cats = categoriesFor(categories.data, type);
  const tabLabel: Record<ListingType, string> = {
    lost: t.hubs.tabLost,
    found: t.hubs.tabFound,
    giveaway: t.hubs.tabGive,
    exchange: t.hubs.tabExchange,
    wanted: t.hubs.tabWanted,
  };
  const active = countActive(f, true);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-[22px] leading-tight font-extrabold">
          {hub === 'lostfound' ? t.hubs.lostFoundTitle : t.hubs.giveTitle}
        </h1>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="icon-btn relative"
            onClick={() => setFiltersOpen(true)}
            aria-label={t.feed.filters}
          >
            <SlidersHorizontal className="size-[22px]" aria-hidden />
            {active > 0 && (
              <span className="bg-primary ring-bg absolute top-1.5 right-1.5 size-2.5 rounded-full ring-2" />
            )}
          </button>
          <Link
            to={`/new?type=${type}`}
            className="btn-primary min-h-10 px-3.5"
            aria-label={t.types[type].action}
          >
            <Plus className="size-5" aria-hidden />
            <span className="hidden sm:inline">{t.types[type].action}</span>
          </Link>
        </div>
      </div>

      <div className="segment mb-3 max-w-md" role="tablist" aria-label={t.feed.type}>
        {tabs.map((tab) => (
          <button
            key={tab.type}
            type="button"
            role="tab"
            aria-selected={tab.type === type}
            className="segment-item"
            onClick={() => navigate({ pathname: tab.path, search: '' }, { replace: true })}
          >
            {tabLabel[tab.type]}
          </button>
        ))}
      </div>

      <div
        className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 py-1"
        role="group"
        aria-label={t.feed.category}
      >
        <button
          type="button"
          className="chip"
          aria-pressed={!f.category}
          onClick={() => setSp(writeFilters(sp, { ...f, category: '' }), { replace: true })}
        >
          {t.common.all}
        </button>
        {cats.map((c) => (
          <button
            key={c.id}
            type="button"
            className="chip"
            aria-pressed={f.category === c.id}
            onClick={() =>
              setSp(writeFilters(sp, { ...f, category: f.category === c.id ? '' : c.id }), { replace: true })
            }
          >
            {localizedName(c)}
          </button>
        ))}
      </div>

      <Results
        fixedType={type}
        hasFilters={active > 0 || Boolean(f.q)}
        onReset={() => setSp(new URLSearchParams(), { replace: true })}
      />

      {filtersOpen && (
        <FiltersDialog
          open
          initial={f}
          fixedType={type}
          onClose={() => setFiltersOpen(false)}
          onApply={(v) => {
            setSp(writeFilters(sp, v), { replace: true });
            setFiltersOpen(false);
          }}
        />
      )}
    </div>
  );
}

export default function SearchPage() {
  const t = useT();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const f = readFilters(sp);
  const [draftQ, setDraftQ] = useState(f.q);
  const [syncedQ, setSyncedQ] = useState(f.q);
  if (f.q !== syncedQ) {
    // URL changed from outside (back button, reset) → reflect it in the input
    setSyncedQ(f.q);
    setDraftQ(f.q);
  }
  const [filtersOpen, setFiltersOpen] = useState(false);
  const active = countActive(f, false);

  return (
    <div>
      <div className="mb-3 flex items-center gap-1">
        <button
          type="button"
          className="icon-btn -ml-2"
          onClick={() => navigate(-1)}
          aria-label={t.common.back}
        >
          <ChevronLeft className="size-6" />
        </button>
        <h1 className="text-[22px] leading-tight font-extrabold">{t.nav.search}</h1>
      </div>
      <form
        role="search"
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSp(writeFilters(sp, { ...f, q: draftQ }), { replace: true });
        }}
      >
        <label htmlFor="search-q" className="sr-only">
          {t.common.search}
        </label>
        <div className="relative flex-1">
          <Search
            className="text-text-2 pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2"
            aria-hidden
          />
          <input
            id="search-q"
            type="search"
            value={draftQ}
            maxLength={100}
            onChange={(e) => setDraftQ(e.target.value)}
            onBlur={() =>
              draftQ.trim() !== f.q && setSp(writeFilters(sp, { ...f, q: draftQ }), { replace: true })
            }
            placeholder={t.home.searchPlaceholder}
            className="field-input pl-11"
            enterKeyHint="search"
          />
        </div>
        <button
          type="button"
          onClick={() => setFiltersOpen(true)}
          aria-label={active ? `${t.feed.filters}: ${active}` : t.feed.filters}
          className="border-line bg-surface relative inline-flex min-h-11 items-center gap-2 rounded-xl border px-3.5 font-semibold"
        >
          <SlidersHorizontal className="size-5" aria-hidden />
          <span className="hidden sm:inline">{t.feed.filters}</span>
          {active > 0 && (
            <span className="bg-primary text-on-primary flex size-5 items-center justify-center rounded-full text-xs">
              {active}
            </span>
          )}
        </button>
      </form>

      <Results
        hasFilters={active > 0 || Boolean(f.q)}
        onReset={() => setSp(new URLSearchParams(), { replace: true })}
      />

      {filtersOpen && (
        <FiltersDialog
          open
          initial={{ ...f, q: draftQ }}
          onClose={() => setFiltersOpen(false)}
          onApply={(v) => {
            setSp(writeFilters(sp, v), { replace: true });
            setFiltersOpen(false);
          }}
        />
      )}
    </div>
  );
}
