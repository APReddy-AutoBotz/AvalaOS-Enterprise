// The workspace a person was last in, kept in the browser so the next visit opens it. The choice itself
// lives in the application shell (JourneyApp.tsx); this is only what survives a reload.
const WORKSPACE_KEY = 'avala.journey.workspace';
export const remembered = (): string | null => { try { return localStorage.getItem(WORKSPACE_KEY); } catch { return null; } };
export const remember = (id: string): void => { try { localStorage.setItem(WORKSPACE_KEY, id); } catch { /* storage unavailable */ } };
