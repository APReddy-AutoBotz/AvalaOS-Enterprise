// Platform packs: a platform's own section headings, applied as a document layout. The default wording
// is technology-neutral; a pack only renames sections (it never hides, moves or adds one), so what the
// facts say is unchanged and the person reviews the renamed list before saving it.
//
// UiPath: the headings of UiPath's default Process Design Document template (the table of contents of
// the template UiPath ships with Task Capture). A section of ours with no UiPath counterpart keeps its
// name. Power Automate is not offered: Microsoft publishes no standard PDD headings to follow.
import type { DocLayout } from './branding.ts';
import type { DocType } from './tree.ts';
import type { OutlineEntry } from './layout.ts';

export interface PlatformPack { id: string; name: string; type: DocType; titles: Record<string, string> }

/** Keyed by our standard section title, so a renumbered outline still gets the right heading. */
export const UIPATH_PDD: PlatformPack = {
  id: 'uipath', name: 'UiPath', type: 'pdd',
  titles: {
    'Introduction': 'Introduction',
    'Purpose of this document': 'Purpose of the Document',
    'Objectives of the process': 'Objectives',
    'Key contacts': 'Key Contacts',
    'Minimum prerequisites for automation': 'Minimum Prerequisites for Automation',
    'As-Is process': 'As-Is Process Description',
    'Process overview': 'Process Overview',
    'Applications used': 'Applications Used in the Process',
    'As-Is process map': 'As-Is Process Map',
    'Detailed As-Is steps': 'Detailed As-Is Process Steps',
    'Input data': 'Input Data Description',
    'To-Be process': 'To-Be Process Description',
    'To-Be process map': 'To-Be Detailed Process Map',
    'In scope for automation': 'In Scope for RPA',
    'Out of scope for automation': 'Out of Scope for RPA',
    'Business exception handling': 'Business Exceptions Handling',
    'Application error handling': 'Application Error and Exception Handling',
    'Reporting and audit': 'Reporting',
    'Other observations': 'Other Observations',
    'Sources': 'Additional Sources of Process Documentation',
  },
};

export const PACKS: PlatformPack[] = [UIPATH_PDD];
export const packsFor = (type: DocType) => PACKS.filter(p => p.type === type);

/**
 * The layout with the pack's headings: each section the pack names takes the platform's title, and
 * everything else in the current layout (hidden sections, order, the company's own sections, titles of
 * sections the pack does not name) is kept. Returns the layout and how many sections were renamed.
 */
export function applyPack(pack: PlatformPack, outline: OutlineEntry[], current: DocLayout): { layout: DocLayout; renamed: number } {
  const sections: DocLayout['sections'] = { ...current.sections };
  let renamed = 0;
  for (const o of outline) {
    const title = pack.titles[o.title];
    if (!title || o.locked) continue;
    const next = { ...sections[o.number] };
    if (title === o.title) delete next.title; else next.title = title;
    if (Object.keys(next).length) sections[o.number] = next; else delete sections[o.number];
    renamed++;
  }
  return { layout: { ...current, sections }, renamed };
}
