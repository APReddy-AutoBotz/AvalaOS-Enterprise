// The trust pages at /privacy, /terms and /security. Like the homepage they load on their own, with no
// application or database client. The words are in domain/site/trust.ts.
import React from 'react';
import { TRUST_PAGES, type TrustPageId } from '../../domain/site/pages.ts';
import { TRUST, UPDATED, inlineParts, type Block } from '../../domain/site/trust.ts';
import { SiteFooter, focus, useGo } from './site.tsx';

const linkCls = `font-medium text-[#002C4B] underline decoration-[#E69F00] decoration-2 underline-offset-4 hover:decoration-[#002C4B] ${focus} focus-visible:outline-[#002C4B]`;

function Text({ text }: { text: string }) {
  return <>{inlineParts(text).map((p, i) => ('href' in p ? <a key={i} href={p.href} className={linkCls}>{p.text}</a> : <React.Fragment key={i}>{p.text}</React.Fragment>))}</>;
}

function BlockView({ block }: { block: Block }) {
  if (typeof block === 'string') return <p><Text text={block} /></p>;
  return <ul className="list-disc space-y-2 pl-5 marker:text-slate-400">{block.list.map((x, i) => <li key={i}><Text text={x} /></li>)}</ul>;
}

export default function TrustPage({ id }: { id: TrustPageId }) {
  const page = TRUST[id];
  const go = useGo();
  React.useEffect(() => { document.title = `${page.title} | Avala OS`; }, [page.title]);
  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900">
      <div className="bg-[#001B2F] text-white">
        <header className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6">
          <a href="/" className={`rounded ${focus} focus-visible:outline-white`}><img src="/brand/avala-os-logo-light.svg" alt="Avala OS, home" className="h-10 w-auto" /></a>
          <nav aria-label="Main" className="flex items-center gap-2 text-sm font-semibold">
            {TRUST_PAGES.map(p => (
              <a key={p.id} href={p.path} aria-current={p.id === id ? 'page' : undefined}
                className={`hidden rounded-lg px-3 py-2 sm:block ${p.id === id ? 'bg-white/10 text-white' : 'text-slate-200 hover:bg-white/10'} ${focus} focus-visible:outline-white`}>{p.label}</a>
            ))}
            <a href={go.href} className={`rounded-lg border border-white/30 px-4 py-2 text-white hover:bg-white/10 ${focus} focus-visible:outline-white`}>{go.label}</a>
          </nav>
        </header>
      </div>

      <main className="flex-1">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-16 lg:py-20">
          <nav aria-label="On this page" className="lg:sticky lg:top-8 lg:self-start">
            <p className="text-sm font-semibold text-slate-900">On this page</p>
            <ol className="mt-3 space-y-1.5 border-l border-slate-200 text-sm">
              {page.sections.map(s => (
                <li key={s.id}><a href={`#${s.id}`} className={`-ml-px block border-l border-transparent pl-3 text-slate-600 hover:border-[#002C4B] hover:text-[#002C4B] ${focus} focus-visible:outline-[#002C4B]`}>{s.title}</a></li>
              ))}
            </ol>
          </nav>

          <article className="min-w-0 max-w-3xl">
            <h1 className="font-display text-4xl font-semibold tracking-tight text-[#002C4B] sm:text-5xl">{page.title}</h1>
            <p className="mt-4 text-lg leading-8 text-slate-700">{page.summary}</p>
            <p className="mt-3 text-sm text-slate-500">Last updated {UPDATED}</p>
            <div className="mt-10 divide-y divide-slate-200 border-t border-slate-200">
              {page.sections.map(s => (
                <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-6 py-8">
                  <h2 id={`${s.id}-h`} className="font-display text-2xl font-semibold tracking-tight text-[#002C4B]">{s.title}</h2>
                  <div className="mt-4 space-y-4 text-base leading-7 text-slate-700">
                    {s.body.map((b, i) => <React.Fragment key={i}><BlockView block={b} /></React.Fragment>)}
                  </div>
                </section>
              ))}
            </div>
          </article>
        </div>
      </main>

      <SiteFooter go={go} />
    </div>
  );
}
