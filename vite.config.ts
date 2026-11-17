import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The site's one build: index.html is the entry; the journey, the homepage and the demo are reached from it.
//
// Kept from the inherited build until the owner agrees to remove them: these names are read by nothing,
// but the build writes them into the settings object of two scripts (JourneyApp, UnsubscribePage), so
// taking them out changes those two files. They are empty unless the old pilot variables are set.
const controlledHumanEnabled = process.env.VITE_PR_C_CONTROLLED_HUMAN_ENABLED === 'authorized';
const controlledHumanBuildValue = (value: string | undefined) => controlledHumanEnabled ? value ?? '' : '';
const hostedSandboxEnabled = !controlledHumanEnabled &&
  process.env.AVALAOS_HOSTED_NONPRODUCTION_STABLE_TESTING === 'authorized' &&
  process.env.SITE_NAME === 'avalaos-pilot';

export default defineConfig({
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  plugins: [react()],
  define: {
    'import.meta.env.VITE_AVALA_HOSTED_SANDBOX_ENABLED': JSON.stringify(hostedSandboxEnabled ? 'true' : 'false'),
    'import.meta.env.VITE_PR_C_CONTROLLED_HUMAN_RELEASE_SHA': JSON.stringify(controlledHumanBuildValue(process.env.COMMIT_REF)),
    'import.meta.env.VITE_PR_C_CONTROLLED_HUMAN_REVIEW_HEAD_SHA': JSON.stringify(controlledHumanBuildValue(process.env.COMMIT_REF)),
    'import.meta.env.VITE_PR_C_CONTROLLED_HUMAN_DEPLOY_ID': JSON.stringify(controlledHumanBuildValue(process.env.DEPLOY_ID)),
    'import.meta.env.VITE_PR_C_CONTROLLED_HUMAN_DEPLOY_ORIGIN': JSON.stringify(controlledHumanBuildValue(process.env.DEPLOY_PRIME_URL)),
    'import.meta.env.VITE_PR_C_CONTROLLED_HUMAN_EXERCISE_DIGEST': JSON.stringify(controlledHumanBuildValue(process.env.PR_C_CONTROLLED_HUMAN_EXERCISE_DIGEST)),
    'import.meta.env.VITE_PR_C_CONTROLLED_HUMAN_TARGET_FINGERPRINT': JSON.stringify(controlledHumanBuildValue(process.env.PR_C_CONTROLLED_HUMAN_TARGET_FINGERPRINT)),
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
