import path from 'path';
import zlib from 'zlib';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// What the section editor's script carries (the Tiptap upgrade, 24 November 2026): its size, and which
// packages are built into it or into any other script, among those Tiptap brings that the editor does not
// use (links, underline, the menus' positioning). Printed by the build, read in CI's log.
const WATCHED = ['@tiptap/extension-link', 'linkifyjs', 'tippy.js', '@tiptap/extension-underline', '@floating-ui/dom', '@floating-ui/core', '@tiptap/extension-bubble-menu', '@tiptap/extension-floating-menu'];
function editorReport(): Plugin {
  return {
    name: 'avala-editor-report',
    apply: 'build',
    generateBundle(_options, bundle) {
      const pkg = (id: string) => id.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[1];
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        const packages = [...new Set(chunk.moduleIds.map(pkg).filter((p): p is string => Boolean(p)))].sort();
        const watched = packages.filter(p => WATCHED.includes(p));
        if (chunk.facadeModuleId?.endsWith('journey/process/SectionEditor.tsx')) {
          console.log(`Section editor's script ${chunk.fileName}: ${chunk.code.length} bytes, ${zlib.gzipSync(chunk.code).length} gzipped; packages: ${packages.join(', ')}`);
        }
        if (watched.length) console.log(`Unused editor packages built into ${chunk.fileName}: ${watched.join(', ')}`);
      }
    },
  };
}

// The site's one build: index.html is the entry; the journey, the homepage and the demo are reached from it.

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  // The visit-counting browser test opens the local build under the site's own name (tests/e2e/visits.spec.ts);
  // this applies only to `vite preview` on a developer's or CI's machine, never to the built site.
  preview: { allowedHosts: ['avalaos.com'] },
  plugins: [react(), editorReport()],
  // The build of Avala OS a kept version records beside its inputs (package 14): Netlify's commit, else "local".
  // Not a secret. It lets the Documents page say a release changed the text only when the inputs prove it.
  // The browser tests' stand-in for AI tasks (journey/store/standIns.ts) is built in only for the test build,
  // which sets VITE_JOURNEY_STORE=memory (playwright.config.ts); elsewhere the branch is false and left out.
  define: {
    __AVALA_BUILD__: JSON.stringify((process.env.COMMIT_REF ?? '').slice(0, 12) || 'local'),
    __AVALA_STAND_INS__: JSON.stringify(process.env.VITE_JOURNEY_STORE === 'memory'),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'vendor-react';
          if (id.includes('node_modules/@supabase')) return 'vendor-supabase';
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
