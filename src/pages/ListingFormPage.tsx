import { zodResolver } from '@hookform/resolvers/zod';
import { ChevronLeft, FileWarning, Info, Plus, TriangleAlert, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, type FieldPath } from 'react-hook-form';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { deletePhoto, uploadListingPhoto } from '@/api/photos';
import {
  useCreateListing,
  useListing,
  useUpdateListing,
  type Listing,
  type ListingUpdate,
} from '@/api/listings';
import { byId, categoriesFor, useCategories, useDistricts } from '@/api/reference';
import { cardTitle, TypeBadge } from '@/components/listing/parts';
import { Counter, EmptyState, ErrorState, InlineError, Notice, PageLoader, Spinner } from '@/components/ui';
import { CONDITIONS, LIMITS, LISTING_TYPES, TYPE_ICON, type ListingType } from '@/config/listing';
import { localizedName, useT } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { formatDate, isoDate } from '@/lib/format';
import { ACCEPT_ATTR } from '@/lib/image-client';
import { publicUrl } from '@/lib/supabase';
import { listingSchema, type ListingFormValues } from '@/lib/validation';
import { useAuth } from '@/providers/AuthProvider';
import { useCity } from '@/providers/CityProvider';
import { useToast } from '@/providers/ToastProvider';

/*
  Publication wizard. The nine steps of the brief are grouped into four screens that follow the
  concept's "Создание объявления" layout:
    1. Тип + категория          (steps 1–2)
    2. Фото + название + описание (steps 3–5)
    3. Район + подробности       (steps 6–7)
    4. Предпросмотр + публикация  (steps 8–9)
*/
type Step = 'kind' | 'content' | 'place' | 'preview';
const STEPS: Step[] = ['kind', 'content', 'place', 'preview'];
const AUTOSAVE_KEY = 'taptim.listing-draft';

const STEP_FIELDS: Record<Step, FieldPath<ListingFormValues>[]> = {
  kind: ['type', 'category_id'],
  content: ['title', 'description'],
  place: [
    'district_id',
    'place_hint',
    'event_date',
    'item_condition',
    'quantity',
    'exchange_wish',
    'wanted_until',
    'is_valuable',
  ],
  preview: [],
};

const EMPTY: ListingFormValues = {
  type: 'lost',
  category_id: '',
  title: '',
  description: '',
  district_id: '',
  place_hint: '',
  event_date: '',
  item_condition: '',
  quantity: 1,
  exchange_wish: '',
  wanted_until: '',
  is_valuable: false,
};

function fromListing(l: Listing): ListingFormValues {
  return {
    type: l.type,
    category_id: l.category_id ?? '',
    title: l.title,
    description: l.description,
    district_id: l.district_id ?? '',
    place_hint: l.place_hint ?? '',
    event_date: l.event_date ?? '',
    item_condition: l.item_condition ?? '',
    quantity: l.quantity ?? 1,
    exchange_wish: l.exchange_wish ?? '',
    wanted_until: l.wanted_until ?? '',
    is_valuable: l.is_valuable,
  };
}

/** Only the fields that belong to the chosen type are sent; the server clears the rest anyway. */
function toPayload(v: ListingFormValues): ListingUpdate {
  const ty = v.type as ListingType;
  return {
    category_id: v.category_id || null,
    title: v.title.trim(),
    description: v.description.trim(),
    district_id: v.district_id || null,
    place_hint: v.place_hint.trim() || null,
    event_date: ty === 'lost' || ty === 'found' ? v.event_date || null : null,
    item_condition:
      ty === 'giveaway' || ty === 'exchange'
        ? ((v.item_condition || null) as Listing['item_condition'])
        : null,
    quantity: ty === 'giveaway' ? Number(v.quantity) || 1 : null,
    exchange_wish: ty === 'exchange' ? v.exchange_wish.trim() || null : null,
    wanted_until: ty === 'wanted' ? v.wanted_until || null : null,
    is_valuable: ty === 'found' ? v.is_valuable : false,
  };
}

export default function ListingFormPage() {
  const { id } = useParams();
  const t = useT();
  const q = useListing(id);
  if (!id) return <Wizard key="new" />;
  if (q.isPending) return <PageLoader />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <EmptyState icon={FileWarning} title={t.common.notFoundTitle} />;
  return <Wizard key={id} existing={q.data.listing} />;
}

function Wizard({ existing }: { existing?: Listing }) {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { cityId } = useCity();
  const [sp] = useSearchParams();
  const categories = useCategories();
  const districts = useDistricts(cityId);
  const create = useCreateListing();
  const update = useUpdateListing();

  const isEdit = Boolean(existing);
  const presetType = LISTING_TYPES.includes(sp.get('type') as ListingType)
    ? (sp.get('type') as ListingType)
    : null;

  const saved = useMemo(() => {
    if (isEdit) return null;
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      return raw ? (JSON.parse(raw) as { values: ListingFormValues; id: string | null; uid: string }) : null;
    } catch {
      return null;
    }
  }, [isEdit]);
  const [askRestore, setAskRestore] = useState(
    Boolean(saved && saved.uid === user?.id && !presetType && saved.values.title),
  );

  const [listingId, setListingId] = useState<string | null>(existing?.id ?? null);
  const [step, setStep] = useState<Step>('kind');
  const [accepted, setAccepted] = useState(isEdit);
  const [serverError, setServerError] = useState<unknown>(null);
  const submitting = useRef(false);

  const form = useForm<ListingFormValues>({
    resolver: zodResolver(listingSchema),
    mode: 'onTouched',
    defaultValues: existing ? fromListing(existing) : { ...EMPTY, type: presetType ?? 'lost' },
  });
  const values = form.watch();
  const type = values.type as ListingType;
  const cat = byId(categories.data).get(values.category_id);

  // Autosave non-sensitive form text locally (UI convenience only; the real draft lives on the server).
  useEffect(() => {
    if (isEdit || askRestore || !user) return;
    const id = window.setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ values, id: listingId, uid: user.id }));
      } catch {
        /* storage full / private mode */
      }
    }, 500);
    return () => window.clearTimeout(id);
  }, [values, listingId, isEdit, askRestore, user]);

  const clearAutosave = () => {
    try {
      localStorage.removeItem(AUTOSAVE_KEY);
    } catch {
      /* ignore */
    }
  };

  /** Creates the server draft lazily (needed before photos can be attached). */
  const ensureDraft = async (): Promise<string> => {
    if (listingId) return listingId;
    const created = await create.mutateAsync({
      type,
      status: 'draft',
      city_id: cityId,
      category_id: values.category_id || null,
      title: values.title.trim().slice(0, LIMITS.titleMax),
    });
    setListingId(created.id);
    return created.id;
  };

  const go = (s: Step) => {
    setStep(s);
    window.scrollTo({ top: 0 });
  };

  const next = async () => {
    setServerError(null);
    const ok = await form.trigger(STEP_FIELDS[step]);
    if (!ok) return;
    if (step === 'kind') {
      try {
        const id = await ensureDraft();
        // keep the server draft's category in sync with the chosen one
        if (!isEdit) await update.mutateAsync({ id, values: { category_id: values.category_id || null } });
      } catch (e) {
        setServerError(e);
        return;
      }
    }
    go(STEPS[Math.min(STEPS.indexOf(step) + 1, STEPS.length - 1)]!);
  };
  const back = () => {
    const i = STEPS.indexOf(step);
    if (i === 0) navigate(-1);
    else go(STEPS[i - 1]!);
  };

  const saveDraft = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setServerError(null);
    try {
      const id = await ensureDraft();
      await update.mutateAsync({ id, values: toPayload(values) });
      toast(t.wizard.draftSaved);
    } catch (e) {
      setServerError(e);
    } finally {
      submitting.current = false;
    }
  };

  const publish = form.handleSubmit(
    async (v) => {
      if (submitting.current) return; // double-submit guard
      submitting.current = true;
      setServerError(null);
      try {
        const id = await ensureDraft();
        const payload = toPayload(v);
        const status = existing && existing.status !== 'draft' ? undefined : 'active';
        const result = await update.mutateAsync({ id, values: status ? { ...payload, status } : payload });
        clearAutosave();
        await qc.invalidateQueries({ queryKey: ['listing', id] });
        toast(
          result.moderation_state === 'pending_review'
            ? t.wizard.publishedPending
            : isEdit
              ? t.common.saved
              : t.wizard.published,
        );
        navigate(`/listing/${id}`, { replace: true });
      } catch (e) {
        // Server validation failed → the listing stays a draft; nothing is published automatically.
        setServerError(e);
      } finally {
        submitting.current = false;
      }
    },
    () => {
      const first = STEPS.find((s) => STEP_FIELDS[s].some((f) => form.getFieldState(f).invalid));
      if (first) go(first);
    },
  );

  const pending = create.isPending || update.isPending;
  const err = (f: FieldPath<ListingFormValues>) => form.formState.errors[f]?.message as string | undefined;
  const cats = categoriesFor(categories.data, type);

  if (askRestore && saved) {
    return (
      <div className="mx-auto max-w-lg pt-4">
        <div className="card space-y-4 p-5">
          <h1 className="text-xl font-extrabold">{t.wizard.restoreDraft}</h1>
          <p className="text-text-2">{saved.values.title}</p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary flex-1"
              onClick={() => {
                form.reset(saved.values);
                setListingId(saved.id);
                setAskRestore(false);
              }}
            >
              {t.wizard.restore}
            </button>
            <button
              type="button"
              className="btn-secondary flex-1"
              onClick={() => {
                clearAutosave();
                setAskRestore(false);
              }}
            >
              {t.wizard.discard}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const stepTitle: Record<Step, string> = {
    kind: t.wizard.groupKind,
    content: t.wizard.groupContent,
    place: t.wizard.groupPlace,
    preview: t.wizard.stepPreview,
  };
  const pos = STEPS.indexOf(step) + 1;
  const isLast = step === 'preview';

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-1 flex items-center gap-1">
        <button type="button" className="icon-btn -ml-2" onClick={back} aria-label={t.common.back}>
          <ChevronLeft className="size-6" />
        </button>
        <h1 className="text-[20px] font-extrabold">{isEdit ? t.wizard.editTitle : t.wizard.createTitle}</h1>
        <span className="text-text-2 ml-auto text-sm font-semibold">
          {pos} / {STEPS.length}
        </span>
      </div>
      <div className="mb-5 flex gap-1.5" aria-hidden>
        {STEPS.map((s, i) => (
          <span key={s} className={`h-1.5 flex-1 rounded-full ${i < pos ? 'bg-primary' : 'bg-surface-2'}`} />
        ))}
      </div>
      <p className="sr-only" aria-live="polite">
        {t.wizard.step} {pos}: {stepTitle[step]}
      </p>

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (isLast) void publish();
          else void next();
        }}
        className="space-y-6"
      >
        {step === 'kind' && (
          <>
            <fieldset>
              <legend className="field-label mb-2.5">{t.wizard.typeLabel}</legend>
              {isEdit && <p className="text-text-2 mb-2 text-sm">{t.wizard.typeNotEditable}</p>}
              <div className="grid grid-cols-3 gap-2.5" role="radiogroup" aria-label={t.wizard.typeLabel}>
                {LISTING_TYPES.map((ty) => {
                  const Icon = TYPE_ICON[ty];
                  const on = type === ty;
                  return (
                    <button
                      key={ty}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={isEdit && !on}
                      onClick={() => {
                        form.setValue('type', ty);
                        if (!categoriesFor(categories.data, ty).some((c) => c.id === values.category_id))
                          form.setValue('category_id', '');
                      }}
                      className={`bg-surface flex aspect-[1/0.92] flex-col items-center justify-center gap-2 rounded-2xl border-[1.5px] px-1 text-[13px] font-semibold transition-colors disabled:opacity-40 ${on ? 'border-primary text-primary-ink' : 'border-line text-text hover:border-primary/50'}`}
                    >
                      <span
                        className={`flex size-10 items-center justify-center rounded-full ${on ? 'bg-primary-soft' : 'bg-surface-2'}`}
                      >
                        <Icon className="size-[22px]" aria-hidden />
                      </span>
                      {t.types[ty].short}
                    </button>
                  );
                })}
              </div>
              <p className="field-hint">{t.types[type].hint}</p>
            </fieldset>

            <div>
              <label htmlFor="category" className="field-label">
                {t.wizard.stepCategory}
              </label>
              <select
                id="category"
                className="field-input"
                aria-invalid={Boolean(err('category_id'))}
                {...form.register('category_id')}
              >
                <option value="">{t.wizard.chooseCategory}</option>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {localizedName(c)}
                  </option>
                ))}
              </select>
              {err('category_id') && <p className="field-error">{err('category_id')}</p>}
            </div>
            {cat?.is_sensitive && (
              <Notice icon={TriangleAlert} tone="warning">
                {cat.id === 'documents' ? t.listing.documentsNotice : t.listing.walletNotice}
              </Notice>
            )}
          </>
        )}

        {step === 'content' && (
          <>
            {listingId && <PhotosRow listingId={listingId} allowed={cat?.allow_photos ?? true} />}
            <div>
              <div className="flex items-end justify-between">
                <label htmlFor="title" className="field-label">
                  {t.wizard.stepTitle}
                </label>
                <Counter value={values.title.length} max={LIMITS.titleMax} />
              </div>
              <input
                id="title"
                className="field-input"
                maxLength={LIMITS.titleMax}
                placeholder={t.wizard.titlePlaceholder}
                aria-invalid={Boolean(err('title'))}
                aria-describedby="title-msg"
                {...form.register('title')}
              />
              <p id="title-msg" className={err('title') ? 'field-error' : 'field-hint'}>
                {err('title') ?? t.wizard.titleHint}
              </p>
            </div>
            <div>
              <div className="flex items-end justify-between">
                <label htmlFor="description" className="field-label">
                  {t.wizard.stepDescription}
                </label>
                <Counter value={values.description.length} max={LIMITS.descriptionMax} />
              </div>
              <textarea
                id="description"
                rows={6}
                className="field-input resize-y"
                maxLength={LIMITS.descriptionMax}
                placeholder={t.wizard.descriptionPlaceholder}
                aria-invalid={Boolean(err('description'))}
                aria-describedby="description-msg"
                {...form.register('description')}
              />
              <p id="description-msg" className={err('description') ? 'field-error' : 'field-hint'}>
                {err('description') ?? (type === 'found' || type === 'lost' ? t.wizard.descriptionHint : '')}
              </p>
            </div>
          </>
        )}

        {step === 'place' && (
          <>
            <div>
              <label htmlFor="district" className="field-label">
                {t.wizard.stepDistrict}
              </label>
              <select
                id="district"
                className="field-input"
                aria-invalid={Boolean(err('district_id'))}
                {...form.register('district_id')}
              >
                <option value="">{t.common.chooseDistrict}</option>
                {(districts.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {localizedName(d)}
                  </option>
                ))}
              </select>
              {err('district_id') && <p className="field-error">{err('district_id')}</p>}
            </div>
            <div>
              <label htmlFor="place" className="field-label">
                {t.wizard.placeHint}
              </label>
              <input
                id="place"
                className="field-input"
                maxLength={LIMITS.placeMax}
                placeholder={t.wizard.placePlaceholder}
                {...form.register('place_hint')}
              />
              <p className="field-hint">{t.wizard.placeWarning}</p>
            </div>

            {(type === 'lost' || type === 'found') && (
              <div>
                <label htmlFor="event_date" className="field-label">
                  {type === 'lost' ? t.wizard.eventDateLost : t.wizard.eventDateFound}
                </label>
                <input
                  id="event_date"
                  type="date"
                  className="field-input"
                  min={isoDate(-LIMITS.eventMaxDaysAgo)}
                  max={isoDate(0)}
                  aria-invalid={Boolean(err('event_date'))}
                  {...form.register('event_date')}
                />
                {err('event_date') && <p className="field-error">{err('event_date')}</p>}
              </div>
            )}
            {type === 'found' && (
              <label className="border-line bg-surface has-[:checked]:border-primary has-[:checked]:bg-primary-soft flex cursor-pointer items-start gap-3 rounded-2xl border p-4">
                <input
                  type="checkbox"
                  className="mt-0.5 size-5 accent-[var(--c-primary)]"
                  {...form.register('is_valuable')}
                />
                <span>
                  <span className="block font-semibold">{t.wizard.valuable}</span>
                  <span className="text-text-2 block text-sm">{t.wizard.valuableHint}</span>
                </span>
              </label>
            )}
            {(type === 'giveaway' || type === 'exchange') && (
              <fieldset>
                <legend className="field-label">{t.wizard.condition}</legend>
                <div className="flex flex-wrap gap-2">
                  {CONDITIONS.map((c) => (
                    <label
                      key={c}
                      className="chip has-[:checked]:bg-primary has-[:checked]:text-on-primary has-[:focus-visible]:outline-primary cursor-pointer has-[:focus-visible]:outline-2"
                    >
                      <input
                        type="radio"
                        value={c}
                        className="sr-only"
                        {...form.register('item_condition')}
                      />
                      {t.condition[c]}
                    </label>
                  ))}
                </div>
                {err('item_condition') && <p className="field-error">{err('item_condition')}</p>}
              </fieldset>
            )}
            {type === 'giveaway' && (
              <div>
                <label htmlFor="quantity" className="field-label">
                  {t.wizard.quantity}
                </label>
                <input
                  id="quantity"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={LIMITS.quantityMax}
                  className="field-input w-32"
                  {...form.register('quantity')}
                />
              </div>
            )}
            {type === 'exchange' && (
              <div>
                <label htmlFor="exchange_wish" className="field-label">
                  {t.wizard.exchangeWish}
                </label>
                <textarea
                  id="exchange_wish"
                  rows={3}
                  maxLength={LIMITS.exchangeWishMax}
                  className="field-input"
                  placeholder={t.wizard.exchangeWishPlaceholder}
                  aria-invalid={Boolean(err('exchange_wish'))}
                  {...form.register('exchange_wish')}
                />
                {err('exchange_wish') && <p className="field-error">{err('exchange_wish')}</p>}
              </div>
            )}
            {type === 'wanted' && (
              <div>
                <label htmlFor="wanted_until" className="field-label">
                  {t.wizard.wantedUntil}
                </label>
                <input
                  id="wanted_until"
                  type="date"
                  className="field-input"
                  min={isoDate(0)}
                  max={isoDate(LIMITS.wantedMaxDays)}
                  aria-invalid={Boolean(err('wanted_until'))}
                  {...form.register('wanted_until')}
                />
                {err('wanted_until') && <p className="field-error">{err('wanted_until')}</p>}
              </div>
            )}
          </>
        )}

        {step === 'preview' && (
          <Preview
            values={values}
            listingId={listingId}
            districtName={localizedName(byId(districts.data).get(values.district_id))}
            categoryName={localizedName(cat)}
            accepted={accepted}
            setAccepted={setAccepted}
          />
        )}

        <InlineError error={serverError ? errorMessage(serverError) : null} />

        <div className="bg-bg/95 sticky bottom-[calc(64px+env(safe-area-inset-bottom))] -mx-4 space-y-2 px-4 pt-2 pb-3 backdrop-blur md:static md:mx-0 md:bg-transparent md:p-0">
          <button
            type="submit"
            className={`${isLast ? 'btn-cta' : 'btn-primary'} w-full`}
            disabled={pending || (isLast && !accepted)}
          >
            {pending && <Spinner className="size-4" />}
            {isLast
              ? pending
                ? t.wizard.publishing
                : existing && existing.status !== 'draft'
                  ? t.wizard.saveChanges
                  : t.wizard.publish
              : t.common.next}
          </button>
          {step !== 'kind' && (!existing || existing.status === 'draft') && (
            <button
              type="button"
              className="btn-ghost text-primary-ink w-full"
              onClick={saveDraft}
              disabled={pending}
            >
              {t.wizard.saveDraft}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

/** Concept's photo row: dashed "+" tile followed by thumbnails with a remove badge. */
function PhotosRow({ listingId, allowed }: { listingId: string; allowed: boolean }) {
  const t = useT();
  const toast = useToast();
  const q = useListing(listingId);
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [removing, setRemoving] = useState<string | null>(null);
  const photos = q.data?.photos ?? [];
  const room = LIMITS.photosMax - photos.length - uploading;

  if (!allowed)
    return (
      <Notice icon={FileWarning} tone="warning">
        {t.wizard.photosForbidden}
      </Notice>
    );

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, Math.max(0, room));
    setUploading((n) => n + list.length);
    let sort = photos.length;
    for (const f of list) {
      try {
        await uploadListingPhoto(listingId, f, sort++);
      } catch (e) {
        toast(e instanceof Error ? e.message : errorMessage(e), 'error');
      } finally {
        setUploading((n) => n - 1);
        await qc.invalidateQueries({ queryKey: ['listing', listingId] });
      }
    }
    if (input.current) input.current.value = '';
  };

  return (
    <div>
      <div className="flex items-end justify-between">
        <span className="field-label">{t.wizard.stepPhotos}</span>
        <span className="text-text-2 text-xs tabular-nums">
          {photos.length}/{LIMITS.photosMax}
        </span>
      </div>
      <ul className="no-scrollbar -mx-4 flex gap-2.5 overflow-x-auto px-4 pt-1 pb-1">
        {room > 0 && (
          <li className="shrink-0">
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="border-line bg-surface text-text-2 hover:border-primary hover:text-primary-ink flex size-[84px] items-center justify-center rounded-2xl border-[1.5px] border-dashed transition-colors"
              aria-label={t.wizard.addPhoto}
            >
              <Plus className="size-7" aria-hidden />
            </button>
          </li>
        )}
        {Array.from({ length: uploading }, (_, i) => (
          <li
            key={`u${i}`}
            className="skeleton flex size-[84px] shrink-0 items-center justify-center rounded-2xl"
          >
            <Spinner className="text-text-2 size-6" />
            <span className="sr-only">{t.wizard.uploading}</span>
          </li>
        ))}
        {photos.map((p) => (
          <li key={p.id} className="relative size-[84px] shrink-0">
            <img
              src={publicUrl('listing-photos', p.thumb_path ?? p.storage_path) ?? ''}
              alt=""
              className="size-full rounded-2xl object-cover"
            />
            <button
              type="button"
              disabled={removing === p.id}
              onClick={async () => {
                setRemoving(p.id);
                try {
                  await deletePhoto(p.id);
                  await qc.invalidateQueries({ queryKey: ['listing', listingId] });
                } catch (e) {
                  toast(e instanceof Error ? e.message : errorMessage(e), 'error');
                } finally {
                  setRemoving(null);
                }
              }}
              className="bg-text text-bg absolute -top-1.5 -right-1.5 flex size-7 items-center justify-center rounded-full shadow"
              aria-label={t.wizard.removePhoto}
            >
              {removing === p.id ? <Spinner className="size-3.5" /> : <X className="size-4" />}
            </button>
          </li>
        ))}
      </ul>
      <input
        ref={input}
        type="file"
        accept={ACCEPT_ATTR}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => onFiles(e.target.files)}
      />
      <p className="field-hint flex items-start gap-1.5">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        {t.wizard.photosHint}
      </p>
    </div>
  );
}

function Preview({
  values,
  listingId,
  districtName,
  categoryName,
  accepted,
  setAccepted,
}: {
  values: ListingFormValues;
  listingId: string | null;
  districtName: string;
  categoryName: string;
  accepted: boolean;
  setAccepted: (v: boolean) => void;
}) {
  const t = useT();
  const q = useListing(listingId ?? undefined);
  const cover = q.data?.photos[0];
  const type = values.type as ListingType;
  return (
    <div className="space-y-4">
      <h2 className="text-[17px] font-extrabold">{t.wizard.stepPreview}</h2>
      <div className="card overflow-hidden">
        {cover && (
          <img
            src={publicUrl('listing-photos', cover.storage_path) ?? ''}
            alt=""
            className="aspect-[16/10] w-full object-cover"
          />
        )}
        <div className="space-y-2 p-4">
          <TypeBadge type={type} />
          <h3 className="text-lg font-extrabold break-words">
            {cardTitle({ type, title: values.title || '—', exchange_wish: values.exchange_wish || null })}
          </h3>
          <p className="text-text-2 text-sm">
            {[categoryName, districtName, values.place_hint].filter(Boolean).join(' · ')}
          </p>
          {values.event_date && (type === 'lost' || type === 'found') && (
            <p className="text-sm">
              {type === 'lost' ? t.listing.lostOn : t.listing.foundOn}: {formatDate(values.event_date)}
            </p>
          )}
          {values.item_condition && (type === 'giveaway' || type === 'exchange') && (
            <p className="text-sm">
              {t.listing.condition}: {t.condition[values.item_condition as keyof typeof t.condition]}
            </p>
          )}
          {type === 'wanted' && values.wanted_until && (
            <p className="text-sm">
              {t.listing.actualUntil}: {formatDate(values.wanted_until)}
            </p>
          )}
          <p className="user-text pt-1 text-[15px]">{values.description}</p>
        </div>
      </div>
      <label className="bg-surface-2 flex cursor-pointer items-start gap-3 rounded-2xl p-4">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          className="mt-0.5 size-5 shrink-0 accent-[var(--c-primary)]"
        />
        <span className="text-sm">
          {t.wizard.rulesConfirm}{' '}
          <Link to="/rules" target="_blank" className="text-primary-ink font-semibold underline">
            {t.nav.rules}
          </Link>
        </span>
      </label>
    </div>
  );
}
