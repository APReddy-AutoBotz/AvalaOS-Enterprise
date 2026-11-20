import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const joinName = (...parts) => parts.join('_');
const v = 'VITE';
const sb = 'SUPABASE';
const db = 'DATABASE';
const api = 'API';
const key = 'KEY';
const secret = 'SECRET';
const token = 'TOKEN';
const role = 'ROLE';
const providerA = 'GROQ';
const providerB = 'GEMINI';
const publicPrefix = 'AVALA_PROVIDER';
const storageGlobal = `local${'Storage'}`;

const ruleIds = [
  'tracked-env-file',
  'server-only-in-client',
  'provider-key-in-client',
  'secret-storage-key',
  'raw-secret-literal',
];

const excludedDirectories = new Set([
  '.git',
  '.turbo',
  '.vite',
  '.agent',
  'build',
  'coverage',
  'dist',
  'node_modules',
]);

const serverOnlyNames = [
  joinName(sb, 'URL'),
  joinName(sb, 'ANON', key),
  joinName(sb, 'SERVICE', role, key),
  joinName(db, 'URL'),
  joinName(sb, 'ACCESS', token),
  joinName('PG', 'PASSWORD'),
  joinName('JWT', secret),
  joinName('EXPORTS', 'BUCKET'),
  joinName('SOURCE', 'UPLOADS', 'BUCKET'),
  joinName(providerA, api, key),
  joinName(providerB, api, key),
  joinName('OPENAI', api, key),
  joinName('ANTHROPIC', api, key),
  joinName('AZURE', 'OPENAI', api, key),
];

const directProviderNames = [
  joinName(v, providerA, api, key),
  joinName(v, providerB, api, key),
  joinName(providerA, api, key),
  joinName(providerB, api, key),
  joinName('OPENAI', api, key),
  joinName('ANTHROPIC', api, key),
  joinName('AZURE', 'OPENAI', api, key),
];

// Files that may name a server-only setting without holding a value: the browser's own list of settings names
// VITE_SUPABASE_ANON_KEY, the public key, whose name contains SUPABASE_ANON_KEY.
const localDemoDebtPaths = new Set([
  'vite-env.d.ts',
]);

const allowedNameOnlyPrefixes = [
  'docs/',
  'docs/schema/',
  'supabase/functions/',
  'scripts/check-secret-hygiene.mjs',
];

// What reaches the browser: the journey, the shared rules it bundles, the page and the build's settings
// (package 13 A: the folders of the earlier application are gone since package 15).
const clientPathPrefixes = [
  'journey/',
  'domain/',
  'services/',
  'public/',
];

const clientPathNames = new Set([
  'index.html',
  'index.tsx',
  'vite-env.d.ts',
  'vite.config.ts',
  'tailwind.config.js',
]);

const normalizePath = (filePath) => filePath.split(path.sep).join('/');

const shouldSkipRelativePath = (relativePath) =>
  relativePath.split('/').some((segment) => excludedDirectories.has(segment));

const listRepositoryFiles = () => {
  const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map(normalizePath)
    .filter((relativePath) => !shouldSkipRelativePath(relativePath))
    .sort((a, b) => a.localeCompare(b));
};

const isEnvPath = (relativePath) => {
  const base = path.posix.basename(relativePath);
  return base === '.env' || base.startsWith('.env.');
};

const isProbablyText = (buffer) => !buffer.includes(0);

const isTestPath = (relativePath) =>
  /(^|\/)[^/]+\.(test|spec)\.[cm]?[jt]sx?$/.test(relativePath);

const isAllowedNameOnlyPath = (relativePath) =>
  isTestPath(relativePath)
  || allowedNameOnlyPrefixes.some((prefix) => relativePath.startsWith(prefix));

const isClientPath = (relativePath) => {
  if (isAllowedNameOnlyPath(relativePath)) return false;
  if (relativePath.startsWith('supabase/')) return false;
  if (relativePath.startsWith('scripts/')) return false;
  if (relativePath.startsWith('.github/')) return false;
  return clientPathNames.has(relativePath)
    || clientPathPrefixes.some((prefix) => relativePath.startsWith(prefix));
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nameRegex = (name) => new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(name)}([^A-Za-z0-9_]|$)`);

const containsName = (lineText, name) => nameRegex(name).test(lineText);

const createHit = ({ ruleId, relativePath, lineNumber, classification }) => ({
  ruleId,
  path: relativePath,
  line: lineNumber,
  classification,
});

const rawSecretLiteralPatterns = [
  {
    id: 'provider-key-prefix',
    regex: /(?<![A-Za-z0-9_])(?:sk-[A-Za-z0-9_-]{32,}|sk_live_[A-Za-z0-9_-]{24,}|sk-ant-[A-Za-z0-9_-]{24,}|gsk_[A-Za-z0-9_-]{24,}|AIza[A-Za-z0-9_-]{30,}|xox[baprs]-[A-Za-z0-9-]{20,}|gh[pousr]_[A-Za-z0-9_]{24,})(?![A-Za-z0-9_])/,
  },
  {
    id: 'bearer-token-assignment',
    regex: /\b(?:Bearer|bearer)\s+[A-Za-z0-9._~+/=-]{32,}/,
  },
  {
    id: 'jwt-like-value',
    regex: /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/,
  },
  {
    id: 'hosted-project-url',
    regex: /https:\/\/[a-z0-9]{18,}\.supabase\.co\b/i,
  },
];

const sensitiveStorageKeyPattern = /(?:api[-_ ]?key|provider[-_ ]?key|token|service[-_ ]?role|secret|credential|password)/i;
const deterministicBrowserAuthFixturePaths = new Set([
  'tests/browser/enterpriseLifecycleAcceptance/actorEntryNavigation.spec.ts',
  'tests/browser/pr1c.spec.ts',
  'tests/browser/pr1dNetworkFixture.ts',
  'tests/browser/pr1e.spec.ts',
  'tests/browser/pr1f.spec.ts',
  'tests/browser/pr1g.spec.ts',
]);
const isDeterministicBrowserAuthFixtureWrite = (relativePath, lineText) => {
  const fixtureKey = ['sb', '127', 'auth', token.toLowerCase()].join('-');
  const syntheticFixtureKey = ['sb', 'synthetic', 'auth', token.toLowerCase()].join('-');
  return (deterministicBrowserAuthFixturePaths.has(relativePath)
    && lineText.includes(`${storageGlobal}.setItem('${fixtureKey}'`))
    || (['scripts/prCSyntheticAcceptanceBrowser.test.mjs', 'scripts/prCSyntheticBrowserApi.test.mjs'].includes(relativePath)
      && lineText.includes(`${storageGlobal}.setItem('${syntheticFixtureKey}'`));
};


const isStorageWrite = (lineText) => {
  const storageSet = new RegExp(`\\b${storageGlobal}\\.setItem\\s*\\(`);
  return storageSet.test(lineText) || /\bStorageService\.save\s*\(/.test(lineText);
};

const isCleanupOnlyStorageUse = (lineText) => {
  const storageRemove = new RegExp(`\\b${storageGlobal}\\.removeItem\\s*\\(`);
  return storageRemove.test(lineText) || /\bStorageService\.remove\s*\(/.test(lineText);
};

const scanTextFile = (relativePath, text) => {
  const forbidden = [];
  let allowedCount = 0;
  const lines = text.split(/\r?\n/);
  const clientPath = isClientPath(relativePath);
  const allowedNameOnlyPath = isAllowedNameOnlyPath(relativePath);
  const legacyDebtPath = localDemoDebtPaths.has(relativePath);

  lines.forEach((lineText, index) => {
    const lineNumber = index + 1;

    if (clientPath) {
      for (const name of serverOnlyNames) {
        if (!containsName(lineText, name)) continue;
        forbidden.push(createHit({
          ruleId: 'server-only-in-client',
          relativePath,
          lineNumber,
          classification: 'server-only variable name in browser/client path',
        }));
      }
    }

    for (const name of directProviderNames) {
      if (!containsName(lineText, name)) continue;

      if (legacyDebtPath || allowedNameOnlyPath) {
        allowedCount += 1;
        continue;
      }

      if (clientPath) {
        forbidden.push(createHit({
          ruleId: 'provider-key-in-client',
          relativePath,
          lineNumber,
          classification: 'direct provider key variable name in browser/client path',
        }));
      }
    }

    for (const name of serverOnlyNames) {
      if (containsName(lineText, name) && allowedNameOnlyPath) {
        allowedCount += 1;
      }
    }

    if (lineText.includes(publicPrefix) && allowedNameOnlyPath) {
      allowedCount += 1;
    }

    if (isStorageWrite(lineText) && sensitiveStorageKeyPattern.test(lineText)) {
      if (isDeterministicBrowserAuthFixtureWrite(relativePath, lineText)) {
        allowedCount += 1;
      } else {
        forbidden.push(createHit({
          ruleId: 'secret-storage-key',
          relativePath,
          lineNumber,
          classification: 'browser storage write targets a secret-like key',
        }));
      }
    } else if (isCleanupOnlyStorageUse(lineText) && sensitiveStorageKeyPattern.test(lineText)) {
      allowedCount += 1;
    }

    for (const pattern of rawSecretLiteralPatterns) {
      if (!pattern.regex.test(lineText)) continue;
      forbidden.push(createHit({
        ruleId: 'raw-secret-literal',
        relativePath,
        lineNumber,
        classification: `high-confidence raw secret-looking literal (${pattern.id})`,
      }));
    }
  });

  return { forbidden, allowedCount };
};

const scan = () => {
  const files = listRepositoryFiles();
  const forbidden = [];
  let allowedCount = 0;
  let trackedEnvCount = 0;

  for (const relativePath of files) {
    if (isEnvPath(relativePath)) {
      trackedEnvCount += 1;
      forbidden.push(createHit({
        ruleId: 'tracked-env-file',
        relativePath,
        lineNumber: 1,
        classification: 'tracked or unignored environment file path',
      }));
      continue;
    }

    const absolutePath = path.join(repoRoot, ...relativePath.split('/'));
    const buffer = fs.readFileSync(absolutePath);
    if (!isProbablyText(buffer)) continue;

    const result = scanTextFile(relativePath, buffer.toString('utf8'));
    allowedCount += result.allowedCount;
    forbidden.push(...result.forbidden);
  }

  return { allowedCount, forbidden, trackedEnvCount };
};

const { allowedCount, forbidden, trackedEnvCount } = scan();

console.log('Secret hygiene static scan');
console.log(`Rules checked: ${ruleIds.length}`);
console.log(`Allowed classified hits: ${allowedCount}`);
console.log(`Forbidden hits: ${forbidden.length}`);
console.log(`Tracked .env* files: ${trackedEnvCount}`);

if (forbidden.length > 0) {
  console.error('\nForbidden hits:');
  for (const hit of forbidden) {
    console.error(`- ${hit.ruleId} | ${hit.path}:${hit.line} | ${hit.classification}`);
  }
}

if (forbidden.length > 0) {
  console.error('\nSecret hygiene static scan failed.');
  process.exitCode = 1;
} else {
  console.log('\nSecret hygiene static scan passed.');
}
