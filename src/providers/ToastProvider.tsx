import { CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type Tone = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  tone: Tone;
  text: string;
}

const Ctx = createContext<(text: string, tone?: Tone) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (text: string, tone: Tone = 'success') => {
      const id = ++seq.current;
      setToasts((t) => [...t.slice(-2), { id, tone, text }]);
      window.setTimeout(() => dismiss(id), tone === 'error' ? 6000 : 3500);
    },
    [dismiss],
  );

  return (
    <Ctx.Provider value={push}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6"
        aria-live="polite"
        role="status"
      >
        {toasts.map((t) => {
          const Icon = t.tone === 'success' ? CircleCheck : t.tone === 'error' ? TriangleAlert : Info;
          return (
            <div
              key={t.id}
              className="border-line bg-surface pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border px-4 py-3 text-[15px] shadow-lg"
            >
              <Icon
                className={`mt-0.5 size-5 shrink-0 ${t.tone === 'error' ? 'text-danger' : t.tone === 'info' ? 'text-info' : 'text-primary'}`}
                aria-hidden
              />
              <p className="text-text min-w-0 flex-1">{t.text}</p>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="text-text-2 hover:bg-surface-2 -m-1 rounded-lg p-1"
                aria-label="Закрыть"
              >
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
