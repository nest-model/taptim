import { zodResolver } from '@hookform/resolvers/zod';
import { Flag } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { useCreateReport, type ReportInput } from '@/api/account';
import { Counter, InlineError, Modal, Spinner } from '@/components/ui';
import { LIMITS } from '@/config/listing';
import { useT } from '@/i18n';
import { reportSchema } from '@/lib/validation';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { LoginPrompt } from './guards';

type Values = z.input<typeof reportSchema>;
const REASONS = ['fraud', 'prohibited', 'spam', 'abuse', 'dangerous', 'rules', 'other'] as const;

export function ReportButton({
  target,
  className = 'btn-ghost text-text-2',
}: {
  target: ReportInput;
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <Flag className="size-4" aria-hidden />
        {t.common.report}
      </button>
      {open && <ReportDialog target={target} onClose={() => setOpen(false)} />}
    </>
  );
}

export function ReportDialog({ target, onClose }: { target: ReportInput; onClose: () => void }) {
  const t = useT();
  const { user } = useAuth();
  const toast = useToast();
  const create = useCreateReport();
  const form = useForm<Values>({
    resolver: zodResolver(reportSchema),
    defaultValues: { reason: 'fraud', description: '' },
  });
  const description = form.watch('description') ?? '';

  const submit = form.handleSubmit((v) => {
    if (create.isPending) return;
    create.mutate(
      { ...target, reason: v.reason, description: v.description ?? '' },
      {
        onSuccess: () => {
          toast(t.reports.sent);
          onClose();
        },
      },
    );
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={t.reports.title}
      footer={
        user ? (
          <>
            <button type="button" className="btn-secondary" onClick={onClose}>
              {t.common.cancel}
            </button>
            <button type="submit" form="report-form" className="btn-primary" disabled={create.isPending}>
              {create.isPending && <Spinner className="size-4" />}
              {t.reports.send}
            </button>
          </>
        ) : undefined
      }
    >
      {!user ? (
        <LoginPrompt />
      ) : (
        <form id="report-form" onSubmit={submit} className="space-y-4" noValidate>
          <fieldset>
            <legend className="field-label">{t.reports.reason}</legend>
            <div className="grid gap-1.5">
              {REASONS.map((r) => (
                <label
                  key={r}
                  className="border-line has-[:checked]:border-primary has-[:checked]:bg-primary-soft flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3.5"
                >
                  <input
                    type="radio"
                    value={r}
                    {...form.register('reason')}
                    className="size-4 accent-[var(--c-primary)]"
                  />
                  <span className="text-[15px]">{t.reports.reasons[r]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <div className="flex items-end justify-between">
              <label htmlFor="report-desc" className="field-label">
                {t.reports.description}
              </label>
              <Counter value={description.length} max={LIMITS.reportMax} />
            </div>
            <textarea
              id="report-desc"
              rows={3}
              maxLength={LIMITS.reportMax}
              placeholder={t.reports.descriptionPlaceholder}
              className="field-input resize-y"
              {...form.register('description')}
            />
          </div>
          <p className="text-text-2 text-sm">{t.reports.anonymityNote}</p>
          <InlineError error={create.error} />
        </form>
      )}
    </Modal>
  );
}
