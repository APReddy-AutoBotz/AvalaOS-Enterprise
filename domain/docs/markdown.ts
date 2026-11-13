// A document tree as Markdown, for wikis and quick review.
import { richMarkdown } from './edits.ts';
import type { Block, Cell, DocTree } from './tree.ts';

const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n+/g, ' ');
const c = (x: Cell) => esc(x.missing ? `*${x.text}*` : x.text);

function block(b: Block): string {
  switch (b.kind) {
    case 'paragraph': return b.text;
    case 'list': return b.items.map(i => `- ${i}`).join('\n');
    case 'callout': return `> ${b.tone === 'warning' ? '**Caution.** ' : ''}${b.text}`;
    case 'openItem': return `> **Open:** ${b.item.text}`;
    case 'rich': return richMarkdown(b.html);
    case 'figure': return `*${b.caption}*\n\n\`\`\`mermaid\n${b.mermaid}\n\`\`\``;
    case 'keyValue': return [`| ${esc(b.caption)} | |`, '| --- | --- |', ...b.rows.map(r => `| ${esc(r.key)} | ${c(r.value)} |`)].join('\n');
    case 'table': return b.rows.length
      ? [`*${esc(b.caption)}*`, '', `| ${b.columns.map(esc).join(' | ')} |`, `| ${b.columns.map(() => '---').join(' | ')} |`, ...b.rows.map(r => `| ${r.map(c).join(' | ')} |`)].join('\n')
      : `*${esc(b.caption)}:* ${b.empty}`;
  }
}

export function toMarkdown(doc: DocTree): string {
  return [
    `# ${doc.title}`, `**${doc.subtitle}**`, '',
    ...doc.control.map(x => `- ${x.key}: ${x.value}`), '',
    ...doc.sections.flatMap(s => [`${s.level === 1 ? '##' : '###'} ${s.number} ${s.title}`, '', ...s.blocks.flatMap(b => [block(b), ''])]),
  ].join('\n');
}
