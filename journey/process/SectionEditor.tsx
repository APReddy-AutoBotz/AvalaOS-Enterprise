// Rich-text editing of a section's narrative with TipTap: paragraphs, bold, italic, lists and
// sub-headings, the tags the documents render. Loaded on demand, only when someone edits.
import React from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Button, cx } from '../ui.tsx';
import type { GroundingIssue } from '../../domain/docs/narrative.ts';

const ISSUE: Record<GroundingIssue['kind'], string> = { name: 'Not in the process', number: 'Number not in the process', filler: 'Filler' };

export default function SectionEditor({ initial, title, onSave, onCancel, busy, check, draft }: {
  initial: string; title: string; onSave: (html: string) => void; onCancel: () => void; busy: boolean;
  /** Names, numbers and filler in the text that the process does not have. */
  check: (html: string) => GroundingIssue[];
  /** Drafts the section from the process's facts with AI, when the AI service is available. */
  draft?: () => Promise<{ html: string; sentences: number }>;
}) {
  const [issues, setIssues] = React.useState<GroundingIssue[] | null>(null);
  const [drafting, setDrafting] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [3, 4] }, code: false, codeBlock: false, blockquote: false, horizontalRule: false, strike: false })],
    content: initial || '<p></p>',
    onUpdate: () => setIssues(null),
    immediatelyRender: false,
    editorProps: { attributes: { 'aria-label': `Text of ${title}`, role: 'textbox', 'aria-multiline': 'true', class: 'prose-sm min-h-[7rem] max-w-none px-3 py-2.5 text-sm leading-7 text-slate-800 focus:outline-none [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_h3]:font-semibold [&_h4]:font-semibold' } },
  });
  if (!editor) return null;
  const tool = (label: string, active: boolean, run: () => void) => (
    <button type="button" aria-pressed={active} aria-label={label} title={label} onMouseDown={e => { e.preventDefault(); run(); }}
      className={cx('rounded-md px-2 py-1 text-xs font-semibold', active ? 'bg-[#002C4B] text-white' : 'text-slate-700 hover:bg-slate-100')}>{label}</button>
  );
  return (
    <div className="keep rounded-xl border border-[#002C4B]/30 bg-white shadow-sm" data-testid="section-editor">
      <div className="flex flex-wrap gap-1 border-b border-slate-200 px-2 py-1.5">
        {tool('Bold', editor.isActive('bold'), () => editor.chain().focus().toggleBold().run())}
        {tool('Italic', editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run())}
        {tool('Bullets', editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run())}
        {tool('Numbers', editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run())}
        {tool('Sub-heading', editor.isActive('heading'), () => editor.chain().focus().toggleHeading({ level: 4 }).run())}
      </div>
      <EditorContent editor={editor} />
      {note && <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-600" role="status">{note}</p>}
      {issues && issues.length > 0 && (
        <div className="border-t border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950" data-testid="grounding-issues">
          <p className="font-semibold">Check before saving: the process does not have these.</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">{issues.map((i, n) => <li key={n} className="rounded bg-white px-1.5 py-0.5 ring-1 ring-inset ring-amber-200">{ISSUE[i.kind]}: “{i.text}”</li>)}</ul>
          <p className="mt-1">Add the fact to the process if it is right, or change the text. You can still save it as your own wording.</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-3 py-2">
        <Button onClick={() => { const found = check(editor.getHTML()); if (found.length && !issues) { setIssues(found); return; } onSave(editor.getHTML()); }} disabled={busy}>{busy ? 'Saving…' : issues?.length ? 'Save anyway' : 'Save section'}</Button>
        {draft && <Button variant="secondary" disabled={drafting || busy} onClick={async () => {
          setDrafting(true); setNote(null); setIssues(null);
          try {
            const d = await draft();
            if (!d.sentences) { setNote('The process has no facts for this section yet, so nothing was drafted.'); return; }
            editor.commands.setContent(d.html);
            const found = check(d.html);
            setIssues(found.length ? found : null);
            setNote(`Drafted ${d.sentences} ${d.sentences === 1 ? 'sentence' : 'sentences'} from the process. Read and change it before saving.`);
          } catch (e) { setNote(e instanceof Error ? e.message : 'The draft could not be made.'); } finally { setDrafting(false); }
        }}>{drafting ? 'Drafting…' : 'Draft with AI'}</Button>}
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <span className="ml-auto text-xs text-slate-500">Tables and open items come from the process: change those in the Process stage.</span>
      </div>
    </div>
  );
}
