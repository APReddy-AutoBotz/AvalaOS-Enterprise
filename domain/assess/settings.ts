// The numbers an organisation sets for itself: how many hours a full-time person works in a year,
// where "high value" starts, and where "easier to build" starts. One set per workspace. Until an
// admin sets them, the defaults below apply, and the result says so.
import { PRIORITY } from './priority.ts';

export interface AssessmentSettings {
  /** Hours one full-time person works in a year. */
  hoursPerFte: number;
  /** Hands-on hours a year automation could take, at or above which the value counts as high. */
  valueHoursPerYear: number;
  /** Ease of implementation at or above which the build counts as easier. */
  easeLine: number;
}

export interface SettingsRecord {
  settings: AssessmentSettings;
  /** False while the defaults apply. */
  custom: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

export const DEFAULT_SETTINGS: AssessmentSettings = { hoursPerFte: PRIORITY.hoursPerFte, valueHoursPerYear: PRIORITY.valueHoursPerYear, easeLine: PRIORITY.ease };

export const SETTING_LIMITS: Record<keyof AssessmentSettings, { min: number; max: number; label: string; unit: string; hint: string }> = {
  hoursPerFte: { min: 800, max: 3000, label: 'Hours a full-time person works in a year', unit: 'hours', hint: 'Working days times hours a day, after leave and holidays. Turns hours into people.' },
  valueHoursPerYear: { min: 1, max: 1_000_000, label: 'High value starts at', unit: 'hours a year', hint: 'Hands-on hours a year automation could take. Above this line a process counts as high value.' },
  easeLine: { min: 1, max: 99, label: 'Easier to build starts at', unit: 'ease out of 100', hint: 'Ease of implementation at or above which a build counts as easier.' },
};

export class SettingsError extends Error {}

/** Checks a full set of settings; throws SettingsError naming the first value out of range. */
export function validateSettings(s: AssessmentSettings): AssessmentSettings {
  for (const k of Object.keys(SETTING_LIMITS) as (keyof AssessmentSettings)[]) {
    const v = s[k], lim = SETTING_LIMITS[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new SettingsError(`${lim.label}: enter a number.`);
    if (v < lim.min || v > lim.max) throw new SettingsError(`${lim.label}: enter a number from ${lim.min.toLocaleString('en')} to ${lim.max.toLocaleString('en')}.`);
  }
  return { hoursPerFte: s.hoursPerFte, valueHoursPerYear: s.valueHoursPerYear, easeLine: s.easeLine };
}

/** Settings as stored (possibly partial or from an older version) merged over the defaults; bad values fall back. */
export function settingsFrom(stored: unknown): AssessmentSettings {
  const out = { ...DEFAULT_SETTINGS };
  if (stored && typeof stored === 'object') for (const k of Object.keys(SETTING_LIMITS) as (keyof AssessmentSettings)[]) {
    const v = (stored as Record<string, unknown>)[k], lim = SETTING_LIMITS[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= lim.min && v <= lim.max) out[k] = v;
  }
  return out;
}
