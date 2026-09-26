import { useCallback } from "react";
import { translate, type Language, type TranslationKey } from "@/lib/i18n/dictionary";

// See `lib/i18n/dictionary.ts` for the provenance note on why this
// prerequisite-of-ticket-#28 file exists in a ticket-#31 branch.

/**
 * Returns a translation function bound to `language`. A real i18n library
 * could later replace this hook's internals without changing call sites —
 * callers only ever see `t(key) => string`.
 */
export function useT(language: Language) {
  return useCallback((key: TranslationKey) => translate(language, key), [language]);
}

export { translate };
export type { Language, TranslationKey };
