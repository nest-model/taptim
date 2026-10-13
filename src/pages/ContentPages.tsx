import { FileText } from 'lucide-react';
import { privacy, rules, safety, terms, type ContentPage } from '@/content/ru';
import { Notice, PageHeader } from '@/components/ui';

function Content({ page }: { page: ContentPage }) {
  return (
    <article className="mx-auto max-w-2xl">
      <PageHeader title={page.title} />
      {page.draftNote && (
        <div className="mb-4">
          <Notice icon={FileText} tone="warning">
            Проект документа. Перед публичным запуском текст должен проверить юрист.
          </Notice>
        </div>
      )}
      {page.intro && <p className="text-text-2 mb-6 text-[16px] leading-relaxed">{page.intro}</p>}
      <div className="space-y-6">
        {page.sections.map((s) => (
          <section key={s.heading} className="card p-5">
            <h2 className="mb-3 text-lg font-extrabold">{s.heading}</h2>
            <ul className="space-y-2.5">
              {s.items.map((i) => (
                <li key={i} className="flex gap-3 text-[15px] leading-relaxed">
                  <span className="bg-primary mt-2 size-1.5 shrink-0 rounded-full" aria-hidden />
                  <span>{i}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </article>
  );
}

export const SafetyPage = () => <Content page={safety} />;
export const RulesPage = () => <Content page={rules} />;
export const TermsPage = () => <Content page={terms} />;
export const PrivacyPage = () => <Content page={privacy} />;
