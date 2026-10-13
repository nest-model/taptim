import { Search } from 'lucide-react';
import { useState } from 'react';
import { categoriesFor, useCategories, useDistricts } from '@/api/reference';
import { Modal, Toggle } from '@/components/ui';
import { LISTING_TYPES, type ListingType } from '@/config/listing';
import { localizedName, useT } from '@/i18n';
import { isoDate } from '@/lib/format';
import { useCity } from '@/providers/CityProvider';

export interface FilterValues {
  q: string;
  type: string;
  category: string;
  district: string;
  from: string;
  to: string;
  sort: string;
  photo: boolean;
  closed: boolean;
}

export const FILTER_KEYS = [
  'q',
  'type',
  'category',
  'district',
  'from',
  'to',
  'sort',
  'photo',
  'closed',
] as const;

export function readFilters(sp: URLSearchParams): FilterValues {
  return {
    q: sp.get('q') ?? '',
    type: sp.get('type') ?? '',
    category: sp.get('category') ?? '',
    district: sp.get('district') ?? '',
    from: sp.get('from') ?? '',
    to: sp.get('to') ?? '',
    sort: sp.get('sort') ?? '',
    photo: sp.get('photo') === '1',
    closed: sp.get('closed') === '1',
  };
}

export function writeFilters(sp: URLSearchParams, v: FilterValues): URLSearchParams {
  const next = new URLSearchParams(sp);
  for (const k of FILTER_KEYS) next.delete(k);
  if (v.q.trim()) next.set('q', v.q.trim());
  if (v.type) next.set('type', v.type);
  if (v.category) next.set('category', v.category);
  if (v.district) next.set('district', v.district);
  if (v.from) next.set('from', v.from);
  if (v.to) next.set('to', v.to);
  if (v.sort) next.set('sort', v.sort);
  if (v.photo) next.set('photo', '1');
  if (v.closed) next.set('closed', '1');
  return next;
}

export const countActive = (v: FilterValues, fixedType: boolean) =>
  [!fixedType && v.type, v.category, v.district, v.from, v.to, v.sort, v.photo, v.closed].filter(Boolean)
    .length;

/** Full-screen "Поиск и фильтры" from the concept: staged values, applied with one button. */
export function FiltersDialog({
  open,
  initial,
  fixedType,
  onApply,
  onClose,
}: {
  open: boolean;
  initial: FilterValues;
  fixedType?: ListingType;
  onApply: (v: FilterValues) => void;
  onClose: () => void;
}) {
  const t = useT();
  const { cityId } = useCity();
  const categories = useCategories();
  const districts = useDistricts(cityId);
  // Mounted only while open, so the staged values start from the applied ones.
  const [v, setV] = useState<FilterValues>(initial);
  const set = <K extends keyof FilterValues>(k: K, val: FilterValues[K]) => setV((s) => ({ ...s, [k]: val }));
  const type = (fixedType ?? v.type) as ListingType | '';
  const cats = categoriesFor(categories.data, type || null);
  const showDates = type === 'lost' || type === 'found' || !type;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t.feed.filtersTitle}
      full
      footer={
        <>
          <button type="button" className="btn-cta w-full" onClick={() => onApply(v)}>
            {t.feed.apply}
          </button>
          <button
            type="button"
            className="text-primary-ink mx-auto min-h-10 px-3 text-[15px] font-semibold underline underline-offset-4"
            onClick={() =>
              setV({
                q: v.q,
                type: '',
                category: '',
                district: '',
                from: '',
                to: '',
                sort: '',
                photo: false,
                closed: false,
              })
            }
          >
            {t.feed.resetFilters}
          </button>
        </>
      }
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          onApply(v);
        }}
      >
        <div className="relative">
          <Search
            className="text-text-2 pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2"
            aria-hidden
          />
          <input
            type="search"
            aria-label={t.common.search}
            className="field-input pl-11"
            placeholder={t.common.search + '…'}
            value={v.q}
            maxLength={100}
            onChange={(e) => set('q', e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="f-cat" className="field-label">
            {t.feed.category}
          </label>
          <select
            id="f-cat"
            className="field-input"
            value={v.category}
            onChange={(e) => set('category', e.target.value)}
          >
            <option value="">{t.feed.allCategories}</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {localizedName(c)}
              </option>
            ))}
          </select>
        </div>
        {!fixedType && (
          <div>
            <label htmlFor="f-type" className="field-label">
              {t.feed.type}
            </label>
            <select
              id="f-type"
              className="field-input"
              value={v.type}
              onChange={(e) => setV((s) => ({ ...s, type: e.target.value, category: '' }))}
            >
              <option value="">{t.common.all}</option>
              {LISTING_TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {t.types[ty].plural}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="f-district" className="field-label">
            {t.feed.districtOf} {t.home.cityOf[cityId] ?? ''}
          </label>
          <select
            id="f-district"
            className="field-input"
            value={v.district}
            onChange={(e) => set('district', e.target.value)}
          >
            <option value="">{t.feed.allDistricts}</option>
            {(districts.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {localizedName(d)}
              </option>
            ))}
          </select>
        </div>
        {showDates && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="f-from" className="field-label">
                {t.feed.dateFrom}
              </label>
              <input
                id="f-from"
                type="date"
                className="field-input"
                max={isoDate(0)}
                value={v.from}
                onChange={(e) => set('from', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="f-to" className="field-label">
                {t.feed.dateTo}
              </label>
              <input
                id="f-to"
                type="date"
                className="field-input"
                value={v.to}
                onChange={(e) => set('to', e.target.value)}
              />
            </div>
          </div>
        )}
        <div>
          <label htmlFor="f-sort" className="field-label">
            {t.feed.sort}
          </label>
          <select
            id="f-sort"
            className="field-input"
            value={v.sort}
            onChange={(e) => set('sort', e.target.value)}
          >
            <option value="">{v.q ? t.feed.sortRelevance : t.feed.sortNew}</option>
            <option value="new">{t.feed.sortNew}</option>
            <option value="relevance">{t.feed.sortRelevance}</option>
            <option value="event_date">{t.feed.sortEventDate}</option>
          </select>
        </div>
        <div className="divide-line divide-y">
          <Toggle checked={v.photo} onChange={(x) => set('photo', x)} label={t.feed.withPhoto} />
          <Toggle checked={v.closed} onChange={(x) => set('closed', x)} label={t.feed.includeClosed} />
        </div>
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden>
          {t.feed.apply}
        </button>
      </form>
    </Modal>
  );
}
