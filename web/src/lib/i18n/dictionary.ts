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

  // Ticket #32 (F13): InterviewPage's terminal states for the
  // candidate_info fetch — invalid/malformed token, a transient failure,
  // and the two flavors of `complete` (success vs. error-ended).
  "interview.terminal.invalidToken.title": "This interview link isn't valid",
  "interview.terminal.invalidToken.message":
    "We couldn't find an interview session for this link. It may be mistyped, expired, or already used. Please double-check the link, or contact the person who invited you for a new one.",

  "interview.terminal.transientError.title": "We couldn't load your interview",
  "interview.terminal.transientError.message":
    "This looks like a temporary connection problem. Please try again — if it keeps happening, contact the person who invited you.",

  "interview.terminal.complete.successTitle": "Interview Complete",
  "interview.terminal.complete.successLine1": "Thank you. The interview has been recorded.",
  "interview.terminal.complete.successLine2":
    "The hiring team will review your results and follow up with you.",

  "interview.terminal.complete.errorTitle": "Your interview didn't complete",
  "interview.terminal.complete.errorLine1":
    "Something went wrong on our end before your interview could finish, so it was not completed or evaluated.",
  "interview.terminal.complete.errorLine2":
    "This wasn't caused by anything you did. Please contact the recruiter or hiring team who invited you so they can help you finish the process.",
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

  "interview.terminal.invalidToken.title": "Tautan wawancara ini tidak valid",
  "interview.terminal.invalidToken.message":
    "Kami tidak dapat menemukan sesi wawancara untuk tautan ini. Mungkin salah ketik, sudah kedaluwarsa, atau sudah digunakan. Silakan periksa kembali tautannya, atau hubungi orang yang mengundang Anda untuk mendapatkan tautan baru.",

  "interview.terminal.transientError.title": "Wawancara tidak dapat dimuat",
  "interview.terminal.transientError.message":
    "Sepertinya ada masalah koneksi sementara. Silakan coba lagi — jika terus terjadi, hubungi orang yang mengundang Anda.",

  "interview.terminal.complete.successTitle": "Wawancara Selesai",
  "interview.terminal.complete.successLine1": "Terima kasih. Wawancara Anda telah direkam.",
  "interview.terminal.complete.successLine2":
    "Tim perekrutan akan meninjau hasil Anda dan menghubungi Anda kembali.",

  "interview.terminal.complete.errorTitle": "Wawancara Anda belum selesai",
  "interview.terminal.complete.errorLine1":
    "Terjadi kesalahan di sistem kami sebelum wawancara Anda selesai, sehingga wawancara ini tidak diselesaikan atau dinilai.",
  "interview.terminal.complete.errorLine2":
    "Ini bukan kesalahan Anda. Silakan hubungi perekrut atau tim yang mengundang Anda agar mereka dapat membantu Anda menyelesaikan proses ini.",
};

export const dictionaries: Record<Language, PartialDictionary> = { en, id };

/**
 * The English dictionary on its own, typed as guaranteed-complete (every
 * `TranslationKey` present). This is what the fallback in `useT`/`translate`
 * reads from — going through `dictionaries.en` instead would widen back to
 * `PartialDictionary` and lose that guarantee.
 */
export const fallbackDictionary: Record<TranslationKey, string> = en;
