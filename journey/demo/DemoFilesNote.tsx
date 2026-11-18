// In the demo, under "Read the process from your sources": the sample's files are already read; reading
// one's own happens in a workspace, and the walkthrough is offered with the homepage's own request window.
import React from 'react';
import { DEMO_FILES_NOTE } from '../../domain/site/demo.ts';

const InquiryDialog = React.lazy(() => import('../home/InquiryDialog.tsx').then(m => ({ default: m.InquiryDialog })));

export function DemoFilesNote() {
  const [asking, setAsking] = React.useState(false);
  const button = React.useRef<HTMLButtonElement>(null);
  return (
    <div data-testid="demo-files-note" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-slate-600">
      <span>{DEMO_FILES_NOTE}</span>
      <button ref={button} type="button" onClick={() => setAsking(true)} className="rounded-lg bg-[#E69F00] px-3 py-1.5 font-semibold text-[#001b2f] hover:bg-[#f0ad1a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#002C4B]">Book a walkthrough</button>
      {asking && (
        <React.Suspense fallback={null}>
          <InquiryDialog onClose={() => { setAsking(false); button.current?.focus(); }} />
        </React.Suspense>
      )}
    </div>
  );
}
