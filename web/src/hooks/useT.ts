import { useCallback } from "react";
import {
  dictionaries,
  fallbackDictionary,
  type Language,
  type TranslationKey,
} from "@/lib/i18n/dictionary";

export type { Language, TranslationKey };

/** A translation function: string key in, string copy out. Never throws. */
export type TranslateFn = (key: TranslationKey) => string;

/**
 * Looks up `key` in `language`'s dictionary, falling back to the English
 * string when `language`'s dictionary doesn't define that key. `en` is
 * always complete (see dictionary.ts), so this never throws and never
 * returns blank/undefined (AC28).
 *
 * Exported standalone, not only via `useT`, so non-component code (and
 * tests) can translate without React's rules of hooks getting in the way.
 */
export function translate(language: Language, key: TranslationKey): string {
  return dictionaries[language]?.[key] ?? fallbackDictionary[key];
}

/**
 * Returns a `t(key)` function bound to `language`.
 *
 * Call sites only ever see `t`, a plain string-in/string-out lookup — never
 * the dictionary shape, the language's own record, or how the fallback is
 * implemented. That's deliberate: a real i18n library (react-i18next,
 * FormatJS, ...) could later replace this hook's internals, or the hook
 * itself, without any call site changing.
 *
 * `language` is a plain parameter rather than something this hook reads
 * from context/global state, so callers decide where the active language
 * comes from (e.g. `assessments.language` threaded down from a session
 * resource) and this hook stays a pure "given a language, get a
 * translator" utility.
 */
export function useT(language: Language): TranslateFn {
  return useCallback((key: TranslationKey) => translate(language, key), [language]);
}
