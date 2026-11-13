// Rich-text editing of a section's narrative with TipTap: paragraphs, bold, italic, lists and
// sub-headings, the tags the documents render. Loaded on demand, only when someone edits.
import React from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Button, cx } from '../ui.tsx';

export default function SectionEditor({ initial, title, onSave, onCancel, busy }: { initial: string; title: string; onSave: (html: string) => void; onCancel: () => void; busy: boolean }) {
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [3, 4] }, code: false, codeBlock: false, blockquote: false, horizontalRule: false, strike: false })],
    content: initial || '<p></p>',
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
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-3 py-2">
        <Button onClick={() => onSave(editor.getHTML())} disabled={busy}>{busy ? 'Saving…' : 'Save section'}</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <span className="ml-auto text-xs text-slate-500">Tables and open items come from the process: change those in the Process stage.</span>
      </div>
    </div>
  );
}
