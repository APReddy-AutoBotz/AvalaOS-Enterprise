// The build of Avala OS this page runs, as the build wrote it (vite.config.ts): Netlify's commit, else "local".
// A kept version records it in its inputs index (domain/docs/keep.ts, keptInputs).
declare const __AVALA_BUILD__: string | undefined;
export const BUILD: string = typeof __AVALA_BUILD__ === 'string' ? __AVALA_BUILD__ : 'local';
