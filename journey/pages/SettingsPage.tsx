// Settings of the workspace the person is in: its people, its applications, the lines assessments are
// measured against, its AI, how its documents look, and which parts of Avala OS its organisation uses.
// One section at a time, chosen from the side menu; each has its own address (/settings/people …).
import React from 'react';
import type { JourneyStore, Workspace } from '../store/types.ts';
import type { Nav } from '../JourneyApp.tsx';
import { SETTINGS, type SettingsSection } from '../../domain/workspace/route.ts';
import { settingsFor } from '../../domain/workspace/modules.ts';
import { CARD, cx, EmptyState, PageHead } from '../ui.tsx';
import { PeoplePage } from './PeoplePage.tsx';
import { ApplicationsList } from './ApplicationsList.tsx';
import { AssessmentSettingsPanel } from './WorkspaceSettings.tsx';
import { AiProviderSettings } from './AiProviderSettings.tsx';
import { AiUsagePanel } from './AiUsage.tsx';
import { DocumentBranding } from './DocumentBranding.tsx';
import { OrganizationParts } from './OrganizationParts.tsx';

// One mark per section, drawn in the current colour, so the menu can be scanned without reading it.
const ICON: Record<SettingsSection, React.ReactNode> = {
  people: <><circle cx="7.5" cy="7" r="2.6" /><path d="M2.8 16c.4-2.6 2.2-4 4.7-4s4.3 1.4 4.7 4" /><path d="M13 4.6a2.5 2.5 0 0 1 0 4.8M14.6 12.2c1.5.5 2.4 1.8 2.7 3.8" /></>,
  applications: <><rect x="3" y="3" width="5.5" height="5.5" rx="1.2" /><rect x="11.5" y="3" width="5.5" height="5.5" rx="1.2" /><rect x="3" y="11.5" width="5.5" height="5.5" rx="1.2" /><rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1.2" /></>,
  assessment: <><path d="M3.5 16.5h13" /><path d="M5.5 16.5V11M10 16.5V4.5M14.5 16.5V8" /></>,
  ai: <><path d="M8 3c.4 2.9 1.6 4.9 5 5.5-3.4.6-4.6 2.6-5 5.5-.4-2.9-1.6-4.9-5-5.5 3.4-.6 4.6-2.6 5-5.5Z" /><path d="M15 12c.2 1.5.8 2.3 2.2 2.6-1.4.3-2 1.1-2.2 2.6-.2-1.5-.8-2.3-2.2-2.6 1.4-.3 2-1.1 2.2-2.6Z" /></>,
  documents: <><path d="M5.5 2.8h6L15 6.3v10.9H5.5z" /><path d="M11.5 2.8v3.5H15M8 10.5h4.5M8 13.5h4.5" /></>,
  parts: <><rect x="2.5" y="4" width="15" height="5" rx="2.5" /><circle cx="14.8" cy="6.5" r="1.2" /><rect x="2.5" y="11" width="15" height="5" rx="2.5" /><circle cx="5.2" cy="13.5" r="1.2" /></>,
};

export function SettingsPage({ store, nav, workspace, section, base = '' }: { store: JourneyStore; nav: Nav; workspace: Workspace; section: SettingsSection; base?: string }) {
  const shown = settingsFor(workspace.modules);
  const sections = SETTINGS.filter(s => shown.includes(s.id));
  return (
    <div data-testid="settings">
      <PageHead eyebrow={`${workspace.organizationName} · ${workspace.name}`} title="Settings" summary={`Who works in ${workspace.name}, the applications it works in, and how its assessments, AI and documents are set up.`} />
      <div className="mt-8 grid gap-x-8 gap-y-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className={cx(CARD, 'p-2 lg:sticky lg:top-6 lg:self-start')}>
          <ul className="flex gap-1 overflow-x-auto lg:flex-col">
            {sections.map(s => (
              <li key={s.id}>
                <a href={`${base}/settings/${s.id}`} aria-current={s.id === section ? 'page' : undefined} onClick={e => { e.preventDefault(); nav.go({ page: 'settings', section: s.id }); }}
                  className={cx('flex min-h-11 items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2 text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#002C4B]', s.id === section ? 'bg-[#EEF2F6] font-semibold text-[#002C4B]' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900')}>
                  <svg aria-hidden viewBox="0 0 20 20" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{ICON[s.id]}</svg>
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 max-w-4xl space-y-5" data-testid="settings-section">
          {!shown.includes(section) ? <EmptyState title="Not switched on">This part of Avala OS is not switched on for {workspace.organizationName}.</EmptyState>
            : section === 'people' ? <PeoplePage store={store} workspace={workspace} />
            : section === 'applications' ? <ApplicationsList store={store} workspace={workspace} />
            : section === 'assessment' ? <AssessmentSettingsPanel store={store} workspace={workspace} />
            : section === 'ai' ? <><AiProviderSettings store={store} workspace={workspace} /><AiUsagePanel store={store} workspace={workspace} /></>
            : section === 'documents' ? <DocumentBranding store={store} workspace={workspace} />
            : <OrganizationParts store={store} workspace={workspace} />}
        </div>
      </div>
    </div>
  );
}
