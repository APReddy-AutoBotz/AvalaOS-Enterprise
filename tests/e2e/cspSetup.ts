// Before the browser tests: start with no content security policy reports (tests/e2e/cspReports.ts).
import fs from 'node:fs';
import path from 'node:path';
import { CSP_REPORTS_FILE } from './cspReports.ts';

export default function cspSetup(): void {
  fs.mkdirSync(path.dirname(CSP_REPORTS_FILE), { recursive: true });
  fs.writeFileSync(CSP_REPORTS_FILE, '');
}
