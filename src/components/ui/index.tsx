import { ChevronLeft, LoaderCircle, RotateCcw, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Link } from 'react-router';
import { errorMessage } from '@/lib/errors';
import { publicUrl } from '@/lib/supabase';
import { useT } from '@/i18n';

export function Spinner({ className = 'size-5' }: { className?: string }) {
  return <LoaderCircle className={`animate-spin ${className}`} aria-hidden />;
}

export function PageLoader() {
  const t = useT();
  return (
    <div className="text-text-2 flex min-h-[40vh] items-center justify-center" role="status">
      <Spinner className="size-7" />
      <span className="sr-only">{t.common.loading}</span>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: LucideIcon;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="bg-primary-soft text-primary-ink mb-4 flex size-14 items-center justify-center rounded-2xl">
        <Icon className="size-7" aria-hidden />
      </div>
      <h2 className="text-text text-lg font-bold">{title}</h2>
      {text && <p className="text-text-2 mt-1.5 max-w-sm text-[15px]">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center" role="alert">
      <div className="bg-danger-soft text-danger mb-4 flex size-14 items-center justify-center rounded-2xl">
        <TriangleAlert className="size-7" aria-hidden />
      </div>
      <h2 className="text-lg font-bold">{t.common.errorTitle}</h2>
      <p className="text-text-2 mt-1.5 max-w-sm text-[15px]">{errorMessage(error)}</p>
      {onRetry && (
        <button type="button" className="btn-secondary mt-5" onClick={onRetry}>
          <RotateCcw className="size-4" aria-hidden />
          {t.common.retry}
        </button>
      )}
    </div>
  );
}

export function InlineError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p
      className="bg-danger-soft text-danger flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-sm"
      role="alert"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{typeof error === 'string' ? error : errorMessage(error)}</span>
    </p>
  );
}

export function Notice({
  tone = 'info',
  icon: Icon,
  children,
}: {
  tone?: 'info' | 'warning' | 'success';
  icon: LucideIcon;
  children: ReactNode;
}) {
  const cls =
    tone === 'warning'
      ? 'bg-warning-soft text-warning'
      : tone === 'success'
        ? 'bg-primary-soft text-primary-ink'
        : 'bg-info-soft text-info';
  return (
    <div className={`flex items-start gap-3 rounded-2xl px-4 py-3 text-sm ${cls}`}>
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0 leading-relaxed">{children}</div>
    </div>
  );
}

export function Avatar({
  path,
  name,
  size = 40,
}: {
  path?: string | null;
  name?: string | null;
  size?: number;
}) {
  const url = publicUrl('avatars', path);
  const letter = (name ?? '?').trim().charAt(0).toUpperCase() || '?';
  return url ? (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      className="bg-surface-2 shrink-0 rounded-full object-cover"
      style={{ width: size, height: size }}
      loading="lazy"
    />
  ) : (
    <span
      aria-hidden
      className="bg-primary-soft text-primary-ink flex shrink-0 items-center justify-center rounded-full font-bold"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {letter}
    </span>
  );
}

/** Accessible modal built on <dialog>: focus trap, Esc to close, backdrop click. Bottom sheet on phones. */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  full = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** full-screen page on phones, side panel on desktop (filters) */
  full?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={
        full
          ? 'bg-bg text-text md:border-line m-0 h-dvh max-h-none w-full max-w-none p-0 backdrop:bg-black/45 md:ml-auto md:max-w-md md:border-l'
          : 'border-line bg-surface text-text m-0 mt-auto max-h-[92dvh] w-full max-w-none rounded-t-3xl border p-0 backdrop:bg-black/45 sm:m-auto sm:max-w-lg sm:rounded-3xl'
      }
    >
      {open && (
        <div className={`flex flex-col ${full ? 'h-dvh' : 'max-h-[92dvh]'}`}>
          {full ? (
            <div className="flex items-center gap-2 px-3 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-2">
              <button type="button" onClick={onClose} className="icon-btn" aria-label="Назад">
                <ChevronLeft className="size-6" />
              </button>
              <h2 id={titleId} className="text-lg font-extrabold">
                {title}
              </h2>
            </div>
          ) : (
            <div className="border-line flex items-center justify-between gap-3 border-b px-5 py-4">
              <h2 id={titleId} className="text-lg font-bold">
                {title}
              </h2>
              <button type="button" onClick={onClose} className="icon-btn -mr-2" aria-label="Закрыть">
                <X className="size-5" />
              </button>
            </div>
          )}
          <div className={`flex-1 overflow-y-auto px-5 py-4 ${full ? 'pt-2' : ''}`}>{children}</div>
          {footer && (
            <div
              className={`flex gap-2 px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] ${full ? 'flex-col' : 'border-line flex-col-reverse border-t sm:flex-row sm:justify-end'}`}
            >
              {footer}
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  text,
  confirmLabel,
  danger,
  pending,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  text?: string;
  confirmLabel: string;
  danger?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={pending}>
            {t.common.cancel}
          </button>
          <button
            type="button"
            className={danger ? 'btn-danger' : 'btn-primary'}
            onClick={onConfirm}
            disabled={pending}
          >
            {pending && <Spinner className="size-4" />}
            {confirmLabel}
          </button>
        </>
      }
    >
      {text && <p className="text-text-2 text-[15px]">{text}</p>}
    </Modal>
  );
}

export function PageHeader({ title, back, action }: { title: string; back?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex min-h-11 items-center gap-2">
      {back && (
        <Link to={back} className="icon-btn -ml-2" aria-label="Назад">
          <ChevronLeft className="size-6" />
        </Link>
      )}
      <h1 className="text-text min-w-0 flex-1 text-[22px] leading-tight font-extrabold">{title}</h1>
      {action}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block text-[15px] font-medium">{label}</span>
        {description && <span className="text-text-2 mt-0.5 block text-sm">{description}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-primary' : 'bg-line'}`}
      >
        <span
          className={`absolute top-1 left-1 size-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`}
        />
      </button>
    </div>
  );
}

export function Field({
  label,
  error,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="field-label">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="field-error" role="alert">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${htmlFor}-hint`} className="field-hint">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

export function Counter({ value, max }: { value: number; max: number }) {
  return (
    <span
      className={`text-xs tabular-nums ${value > max ? 'text-danger' : 'text-text-2'}`}
      aria-live="polite"
    >
      {value}/{max}
    </span>
  );
}
