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

  // Ticket #31 (F14): the pre-hardware-check consent/notice screen.
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

  // Ticket #30 (F10/F11/F12/F35): hardware/connectivity check patch.
  "hardwareCheck.step.osAndBrowser": "OS & browser",
  "hardwareCheck.step.internet": "Internet",
  "hardwareCheck.step.camera": "Camera",
  "hardwareCheck.step.microphone": "Microphone",
  "hardwareCheck.step.audio": "Audio output",

  "hardwareCheck.state.checking": "Checking…",
  "hardwareCheck.state.passed": "Passed",
  "hardwareCheck.state.failed": "Failed",
  "hardwareCheck.state.warning": "Needs attention",
  "hardwareCheck.state.waiting": "Waiting",

  "hardwareCheck.progress.label": "Checking your setup",
  "hardwareCheck.progress.stepsComplete": "steps complete",
  "hardwareCheck.progress.estimatedTimeRemaining": "Estimated time remaining",
  "hardwareCheck.progress.seconds": "s",

  "hardwareCheck.camera.notActive": "Camera not active",
  "hardwareCheck.camera.live": "LIVE",
  "hardwareCheck.startInterview": "Start Interview",

  "hardwareCheck.internet.download": "Download",
  "hardwareCheck.internet.upload": "Upload",
  "hardwareCheck.internet.ping": "Ping",

  // F10/D4: an advisory, not a hard block — the candidate can always choose
  // to continue.
  "hardwareCheck.connectivity.warningTitle": "Your connection is slower than recommended",
  "hardwareCheck.connectivity.warningBody":
    "You can still start the interview, but a slow connection may affect audio quality.",
  "hardwareCheck.connectivity.continueAnyway": "Continue anyway",
  "hardwareCheck.connectivity.acknowledged": "Continuing with a slow connection",

  // F12: one distinct message + (where practical) OS-specific recovery
  // steps per real getUserMedia failure cause — never a single generic error.
  "hardwareCheck.mic.noDevice.title": "No microphone found",
  "hardwareCheck.mic.noDevice.body":
    "We couldn't find a microphone on this device. Connect one, then retry.",
  "hardwareCheck.mic.permissionDenied.title": "Microphone access denied",
  "hardwareCheck.mic.permissionDenied.body":
    "Your browser is blocking microphone access for this site.",
  "hardwareCheck.mic.permissionDenied.stepsMac":
    "Open System Settings → Privacy & Security → Microphone, and enable access for your browser. Then retry.",
  "hardwareCheck.mic.permissionDenied.stepsWindows":
    "Click the padlock icon in your browser's address bar → Site permissions → Microphone → Allow. Then retry.",
  "hardwareCheck.mic.permissionDenied.stepsGeneric":
    "Check your browser and operating system settings to allow microphone access for this site. Then retry.",
  "hardwareCheck.mic.busy.title": "Microphone is in use",
  "hardwareCheck.mic.busy.body":
    "Another application appears to be using your microphone. Close it, then retry.",
  "hardwareCheck.mic.unknown.title": "Microphone check failed",
  "hardwareCheck.mic.unknown.body":
    "Something went wrong while checking your microphone. Please retry.",
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

  "hardwareCheck.step.osAndBrowser": "OS & peramban",
  "hardwareCheck.step.internet": "Internet",
  "hardwareCheck.step.camera": "Kamera",
  "hardwareCheck.step.microphone": "Mikrofon",
  "hardwareCheck.step.audio": "Keluaran audio",

  "hardwareCheck.state.checking": "Memeriksa…",
  "hardwareCheck.state.passed": "Lulus",
  "hardwareCheck.state.failed": "Gagal",
  "hardwareCheck.state.warning": "Perlu perhatian",
  "hardwareCheck.state.waiting": "Menunggu",

  "hardwareCheck.progress.label": "Memeriksa perangkat Anda",
  "hardwareCheck.progress.stepsComplete": "langkah selesai",
  "hardwareCheck.progress.estimatedTimeRemaining": "Perkiraan waktu tersisa",
  "hardwareCheck.progress.seconds": "d",

  "hardwareCheck.camera.notActive": "Kamera tidak aktif",
  "hardwareCheck.camera.live": "LANGSUNG",
  "hardwareCheck.startInterview": "Mulai Wawancara",

  "hardwareCheck.internet.download": "Unduh",
  "hardwareCheck.internet.upload": "Unggah",
  "hardwareCheck.internet.ping": "Ping",

  "hardwareCheck.connectivity.warningTitle": "Koneksi Anda lebih lambat dari yang disarankan",
  "hardwareCheck.connectivity.warningBody":
    "Anda tetap dapat memulai wawancara, tetapi koneksi yang lambat dapat memengaruhi kualitas audio.",
  "hardwareCheck.connectivity.continueAnyway": "Tetap lanjutkan",
  "hardwareCheck.connectivity.acknowledged": "Melanjutkan dengan koneksi lambat",

  "hardwareCheck.mic.noDevice.title": "Mikrofon tidak ditemukan",
  "hardwareCheck.mic.noDevice.body":
    "Kami tidak menemukan mikrofon di perangkat ini. Sambungkan satu, lalu coba lagi.",
  "hardwareCheck.mic.permissionDenied.title": "Akses mikrofon ditolak",
  "hardwareCheck.mic.permissionDenied.body":
    "Peramban Anda memblokir akses mikrofon untuk situs ini.",
  "hardwareCheck.mic.permissionDenied.stepsMac":
    "Buka System Settings → Privacy & Security → Microphone, lalu aktifkan akses untuk peramban Anda. Setelah itu, coba lagi.",
  "hardwareCheck.mic.permissionDenied.stepsWindows":
    "Klik ikon gembok di address bar peramban Anda → Site permissions → Microphone → Allow. Setelah itu, coba lagi.",
  "hardwareCheck.mic.permissionDenied.stepsGeneric":
    "Periksa pengaturan peramban dan sistem operasi Anda untuk mengizinkan akses mikrofon pada situs ini. Setelah itu, coba lagi.",
  "hardwareCheck.mic.busy.title": "Mikrofon sedang digunakan",
  "hardwareCheck.mic.busy.body":
    "Sepertinya aplikasi lain sedang menggunakan mikrofon Anda. Tutup aplikasi tersebut, lalu coba lagi.",
  "hardwareCheck.mic.unknown.title": "Pemeriksaan mikrofon gagal",
  "hardwareCheck.mic.unknown.body":
    "Terjadi kesalahan saat memeriksa mikrofon Anda. Silakan coba lagi.",
};

export const dictionaries: Record<Language, PartialDictionary> = { en, id };

/**
 * The English dictionary on its own, typed as guaranteed-complete (every
 * `TranslationKey` present). This is what the fallback in `useT`/`translate`
 * reads from — going through `dictionaries.en` instead would widen back to
 * `PartialDictionary` and lose that guarantee.
 */
export const fallbackDictionary: Record<TranslationKey, string> = en;
