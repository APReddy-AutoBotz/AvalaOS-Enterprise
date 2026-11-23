/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_SUPABASE_URL?: string
    readonly VITE_SUPABASE_ANON_KEY?: string
    readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
    /** "memory" for the in-browser store (the browser tests); otherwise the database (journey/store/index.ts). */
    readonly VITE_JOURNEY_STORE?: string
    /** Sentry's address for this project; without it no error is reported (journey/monitoring.ts). */
    readonly VITE_SENTRY_DSN?: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}

/** True only in a test build (VITE_JOURNEY_STORE=memory when built; vite.config.ts): the browser tests' stand-in for AI tasks is built in. */
declare const __AVALA_STAND_INS__: boolean
