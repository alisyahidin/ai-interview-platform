import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useT, translate, type Language } from "./useT";

describe("useT", () => {
  it("translates a key to that language's string", () => {
    const { result } = renderHook(() => useT("en"));
    expect(result.current("common.retry")).toBe("Retry");
  });

  it("returns a different string for the same key when the language changes", () => {
    const { result, rerender } = renderHook(({ language }) => useT(language), {
      initialProps: { language: "en" as Language },
    });

    const englishCopy = result.current("common.retry");
    expect(englishCopy).toBe("Retry");

    rerender({ language: "id" });
    const indonesianCopy = result.current("common.retry");

    expect(indonesianCopy).toBe("Coba lagi");
    expect(indonesianCopy).not.toBe(englishCopy);
  });

  it("falls back to the English string when the active language's dictionary is missing the key", () => {
    // "common.tryAgain" has no Indonesian entry in the dictionary (see
    // dictionary.ts) — this is the real gap the fallback exists for, not a
    // key made up for this test.
    const { result } = renderHook(() => useT("id"));

    expect(result.current("common.tryAgain")).toBe("Please try again.");
  });

  it("never renders blank or throws for a fallback key", () => {
    const { result } = renderHook(() => useT("id"));

    const value = result.current("common.tryAgain");
    expect(typeof value).toBe("string");
    expect(value.length).toBeGreaterThan(0);
  });
});

describe("translate", () => {
  it("works standalone, without the hook, for the same keys", () => {
    expect(translate("en", "common.loading")).toBe("Loading…");
    expect(translate("id", "common.loading")).toBe("Memuat…");
  });

  it("falls back to English standalone too", () => {
    expect(translate("id", "common.tryAgain")).toBe(translate("en", "common.tryAgain"));
  });
});
