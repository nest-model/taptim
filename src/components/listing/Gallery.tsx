import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import type { ListingPhoto } from '@/api/listings';
import { CategoryIcon } from '@/components/CategoryIcon';
import { publicUrl } from '@/lib/supabase';

/** Full-bleed on phones (as in the concept), rounded card on larger screens. `overlay` = back/heart/badge. */
export function Gallery({
  photos,
  title,
  icon,
  overlay,
}: {
  photos: ListingPhoto[];
  title: string;
  icon?: string | null;
  overlay?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  if (!photos.length) {
    return (
      <div className="bg-primary-soft text-primary-ink relative -mx-4 -mt-3 flex aspect-[4/3] items-center justify-center sm:mx-0 sm:mt-0 sm:aspect-[16/9] sm:rounded-[var(--radius-card)]">
        <CategoryIcon name={icon} className="size-16 opacity-60" />
        {overlay}
      </div>
    );
  }

  const go = (i: number) => {
    const el = ref.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(photos.length - 1, i));
    el.scrollTo({ left: clamped * el.clientWidth, behavior: 'smooth' });
  };

  return (
    <div className="relative -mx-4 -mt-3 sm:mx-0 sm:mt-0">
      <div
        ref={ref}
        onScroll={(e) => setIndex(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
        className="no-scrollbar bg-surface-2 flex aspect-square snap-x snap-mandatory overflow-x-auto sm:aspect-[16/9] sm:rounded-[var(--radius-card)]"
        aria-roledescription="carousel"
        aria-label={`Фотографии: ${title}`}
      >
        {photos.map((p, i) => (
          <img
            key={p.id}
            src={publicUrl('listing-photos', p.storage_path) ?? ''}
            alt={`${title} — фото ${i + 1} из ${photos.length}`}
            className="size-full shrink-0 snap-center object-cover sm:object-contain"
            loading={i === 0 ? 'eager' : 'lazy'}
            decoding="async"
          />
        ))}
      </div>
      {photos.length > 1 && (
        <>
          <span
            className="absolute right-3 bottom-3 rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold text-white"
            aria-hidden
          >
            {index + 1} / {photos.length}
          </span>
          <button
            type="button"
            onClick={() => go(index - 1)}
            disabled={index === 0}
            className="bg-surface/90 absolute top-1/2 left-2 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full shadow disabled:opacity-0 sm:flex"
            aria-label="Предыдущее фото"
          >
            <ChevronLeft className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => go(index + 1)}
            disabled={index === photos.length - 1}
            className="bg-surface/90 absolute top-1/2 right-2 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full shadow disabled:opacity-0 sm:flex"
            aria-label="Следующее фото"
          >
            <ChevronRight className="size-5" />
          </button>
        </>
      )}
      {overlay}
    </div>
  );
}
