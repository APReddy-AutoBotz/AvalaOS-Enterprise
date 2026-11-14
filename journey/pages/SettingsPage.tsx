// Settings of the workspace the person is in: its people, its applications, the lines assessments are
// measured against, its AI, how its documents look, and which parts of Avala OS its organisation uses.
// One section at a time, chosen from the side menu; each has its own address (/settings/people …).
import React from 'react';
import type { JourneyStore, Workspace } from '../store/types.ts';
import type { Nav } from '../JourneyApp.tsx';
import { SETTINGS, type SettingsSection } from '../../domain/workspace/route.ts';
import { settingsFor } from '../../domain/workspace/modules.ts';
import { cx, EmptyState } from '../ui.tsx';
import { PeoplePage } from './PeoplePage.tsx';
import { ApplicationsList } from './ApplicationsList.tsx';
import { AssessmentSettingsPanel } from './WorkspaceSettings.tsx';
import { AiProviderSettings } from './AiProviderSettings.tsx';
import { AiUsagePanel } from './AiUsage.tsx';
import { DocumentBranding } from './DocumentBranding.tsx';
import { OrganizationParts } from './OrganizationParts.tsx';

export function SettingsPage({ store, nav, workspace, section, base = '' }: { store: JourneyStore; nav: Nav; workspace: Workspace; section: SettingsSection; base?: string }) {
  const shown = settingsFor(workspace.modules);
  const sections = SETTINGS.filter(s => shown.includes(s.id));
  return (
    <div data-testid="settings">
      <p className="text-sm text-slate-500">{workspace.organizationName} · {workspace.name}</p>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900">Settings</h1>
      <div className="mt-6 grid gap-x-10 gap-y-5 lg:grid-cols-[12rem_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="lg:sticky lg:top-6 lg:self-start">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col">
            {sections.map(s => (
              <li key={s.id}>
                <a href={`${base}/settings/${s.id}`} aria-current={s.id === section ? 'page' : undefined} onClick={e => { e.preventDefault(); nav.go({ page: 'settings', section: s.id }); }}
                  className={cx('block whitespace-nowrap rounded-lg px-3 py-2 text-sm', s.id === section ? 'bg-white font-semibold text-[#002C4B] shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900')}>{s.label}</a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 max-w-4xl space-y-4" data-testid="settings-section">
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
