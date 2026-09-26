/**
 * Translation dictionary for candidate-facing copy.
 *
 * This is pure data — infrastructure lives in `useT` (see
 * `@/hooks/useT`), not here. Adding a string for a screen that hasn't been
 * localized yet means editing this file only:
 *
 *   1. Add the key (and its English string) to `en`. `en` is the source of
 *      truth — every key that exists anywhere in the dictionary must be
 *      defined here.
 *   2. Optionally add the same key to `id` (or to any other language added
 *      later). A language dictionary may cover as many or as few keys as
 *      have been translated so far.
 *
 * A key with no entry in the active language falls back to its English
 * string (enforced by `useT`/`translate`), so a partially-translated
 * language never crashes a screen or renders blank copy.
 *
 * This file intentionally holds only data (the two dictionaries below and
 * the types derived from them) so it can grow — new keys, new languages —
 * without anyone needing to touch the hook that reads it.
 */

export type Language = "en" | "id";

/**
 * Starter/example keys only. Candidate-facing screens (notice, hardware
 * check, interview, terminal states) bring their own real copy into this
 * dictionary as they migrate to `useT` in their own tickets — these keys
 * exist to give this infrastructure something real to look up and test.
 */
const en = {
  "common.retry": "Retry",
  "common.loading": "Loading…",
  "common.somethingWentWrong": "Something went wrong.",
  "common.tryAgain": "Please try again.",
} as const;

/** Every valid translation key, derived from `en` so the two can't drift. */
export type TranslationKey = keyof typeof en;

type PartialDictionary = Partial<Record<TranslationKey, string>>;

const id: PartialDictionary = {
  "common.retry": "Coba lagi",
  "common.loading": "Memuat…",
  "common.somethingWentWrong": "Terjadi kesalahan.",
  // "common.tryAgain" has no Indonesian translation yet — left out on
  // purpose so the English-fallback path stays exercised for real until a
  // translation lands. See useT()'s fallback behavior.
};

export const dictionaries: Record<Language, PartialDictionary> = { en, id };

/**
 * The English dictionary on its own, typed as guaranteed-complete (every
 * `TranslationKey` present). This is what the fallback in `useT`/`translate`
 * reads from — going through `dictionaries.en` instead would widen back to
 * `PartialDictionary` and lose that guarantee.
 */
export const fallbackDictionary: Record<TranslationKey, string> = en;
