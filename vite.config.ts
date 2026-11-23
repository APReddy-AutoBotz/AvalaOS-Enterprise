import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The site's one build: index.html is the entry; the journey, the homepage and the demo are reached from it.

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  // The visit-counting browser test opens the local build under the site's own name (tests/e2e/visits.spec.ts);
  // this applies only to `vite preview` on a developer's or CI's machine, never to the built site.
  preview: { allowedHosts: ['avalaos.com'] },
  plugins: [react()],
  // The build of Avala OS a kept version records beside its inputs (package 14): Netlify's commit, else "local".
  // Not a secret. It lets the Documents page say a release changed the text only when the inputs prove it.
  define: { __AVALA_BUILD__: JSON.stringify((process.env.COMMIT_REF ?? '').slice(0, 12) || 'local') },
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
