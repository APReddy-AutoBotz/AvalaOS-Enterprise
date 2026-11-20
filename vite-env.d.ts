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
