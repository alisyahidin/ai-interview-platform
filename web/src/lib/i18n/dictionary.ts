// Lightweight, dependency-free i18n dictionary (ticket #28 / D5).
//
// NOTE ON PROVENANCE: this file (and `hooks/useT.ts`) is prerequisite
// infrastructure for ticket #28 ("Phase 4 #1: i18n infrastructure"), which
// was expected to already be merged before ticket #31 (this notice screen)
// started but, as of this branch, is still open (`gh issue view 28` shows
// state OPEN, blocked-by: none, blocking: #30/#31/#32). Rather than block on
// that ticket landing, this implements just enough of its contract — the
// exact shape ticket #31's brief specified — to unblock the consent screen.
// Ticket #28's own implementation/tests should reconcile with this file
// (same merge-reconciliation situation ticket #32 is expected to hit with
// `InterviewPage.test.tsx`).
//
// Scoped to candidate-facing copy only (per D5). `en` is the single source
// of truth for available keys — add a new key (and its English string) here
// to make it usable via `useT()`; `id` translations are optional per key,
// with a missing `id` string falling back to the English one (AC28).

export type Language = "en" | "id";

const en = {
  "notice.title": "Before we begin",
  "notice.recording": "We record your voice (audio) for the full duration of this interview.",
  "notice.aiInvolvement":
    "This interview is conducted by an AI, which asks follow-up questions and evaluates your responses.",
  "notice.purpose":
    "Your recording and evaluation are used only to assess your fit for the role you applied to.",
  "notice.contactLabel": "Questions or concerns about this recording? Contact:",
  "notice.acknowledgeLabel": "I understand what is recorded, that an AI is involved, and why.",
  "notice.continueButton": "I Understand and Agree",
  "notice.error": "Something went wrong saving your acknowledgment. Please try again.",
} as const;

export type TranslationKey = keyof typeof en;

// Partial by design — a language may omit any key and fall back to `en`.
const id: Partial<Record<TranslationKey, string>> = {
  "notice.title": "Sebelum kita mulai",
  "notice.recording": "Kami merekam suara Anda selama wawancara ini berlangsung.",
  "notice.aiInvolvement":
    "Wawancara ini dilakukan oleh AI, yang akan mengajukan pertanyaan lanjutan dan mengevaluasi jawaban Anda.",
  "notice.purpose":
    "Rekaman dan evaluasi Anda hanya digunakan untuk menilai kesesuaian Anda dengan posisi yang dilamar.",
  "notice.contactLabel": "Ada pertanyaan atau keberatan soal rekaman ini? Hubungi:",
  "notice.acknowledgeLabel": "Saya memahami apa yang direkam, keterlibatan AI, dan alasannya.",
  "notice.continueButton": "Saya Mengerti dan Setuju",
  "notice.error": "Terjadi kesalahan saat menyimpan persetujuan Anda. Silakan coba lagi.",
};

const dictionaries: Record<Language, Partial<Record<TranslationKey, string>>> = {
  en,
  id,
};

/**
 * Resolve a translation key for the given language, falling back to the
 * English string when the active language's dictionary doesn't have it
 * (AC28) — never throws, never renders blank.
 */
export function translate(language: Language, key: TranslationKey): string {
  return dictionaries[language]?.[key] ?? en[key];
}
