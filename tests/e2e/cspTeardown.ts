// After every browser test: the run fails if the content security policy reported anything the tests did not
// cause on purpose (tests/e2e/cspReports.ts). Every page the suite opens is under the site's policy, so this
// is the proof that the policy allows everything the product does.
import { readCspReports, unexpected } from './cspReports.ts';

export default async function cspTeardown(): Promise<void> {
  // The browser sends its reports on its own time: give the last ones a moment to arrive.
  await new Promise(r => setTimeout(r, 1500));
  const all = readCspReports();
  const left = unexpected(all);
  console.log(`Content security policy: ${all.length} report${all.length === 1 ? '' : 's'} collected, ${left.length} not made on purpose.`);
  if (left.length) {
    for (const r of left.slice(0, 40)) console.log(`  ${r.directive} would block ${r.blocked} on ${r.page} (${r.source || 'no file'})`);
    throw new Error(`The content security policy reported ${left.length} breach${left.length === 1 ? '' : 'es'} the tests did not make on purpose.`);
  }
}
