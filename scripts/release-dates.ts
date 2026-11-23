// The check "Release dates set" (.github/workflows/release-dates.yml): fails, in plain words, while a date the
// release sets in its own commit is empty. Rules: domain/site/releaseDates.ts.
import { releaseDatesReport } from '../domain/site/releaseDates.ts';

const r = releaseDatesReport();
for (const line of r.lines) console.log(line);
if (!r.ok) {
  // One line GitHub shows on the check itself.
  console.log(`::error title=Release dates not set::${r.lines[0]}`);
  process.exit(1);
}
