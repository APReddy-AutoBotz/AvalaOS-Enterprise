/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PR_C_CONTROLLED_HUMAN_PUBLIC_TARGET_DIGEST?: string;
    readonly VITE_GEMINI_API_KEY: string
    readonly VITE_AVALA_RUNTIME_MODE?: string
    readonly VITE_AVALA_AUTOMATED_TEST_CONTEXT?: string
    readonly VITE_AVALA_HOSTED_SANDBOX_ENABLED?: string
    readonly VITE_AI_EDGE_FUNCTIONS_ENABLED?: string
    readonly VITE_SUPABASE_URL?: string
    readonly VITE_SUPABASE_ANON_KEY?: string
    readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
    readonly VITE_JOURNEY_STORE?: string
    /** Sentry's address for this project; without it no error is reported (journey/monitoring.ts). */
    readonly VITE_SENTRY_DSN?: string
    readonly VITE_PR_C_CONTROLLED_HUMAN_ENABLED?: string
    readonly VITE_PR_C_CONTROLLED_HUMAN_RELEASE_SHA?: string
    readonly VITE_PR_C_CONTROLLED_HUMAN_REVIEW_HEAD_SHA?: string
    readonly VITE_PR_C_CONTROLLED_HUMAN_DEPLOY_ID?: string
    readonly VITE_PR_C_CONTROLLED_HUMAN_DEPLOY_ORIGIN?: string
    readonly VITE_PR_C_CONTROLLED_HUMAN_EXERCISE_DIGEST?: string
    readonly VITE_PR_C_CONTROLLED_HUMAN_TARGET_FINGERPRINT?: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}
