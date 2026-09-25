import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "@/mocks/server";

// jsdom doesn't implement ResizeObserver, which Radix UI primitives (e.g.
// <Select>) use internally to measure their trigger/content. Without this,
// any test that renders a page using those primitives crashes with an
// uncaught "ResizeObserver is not defined" during the commit phase.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom doesn't implement canvas, which axe-core's colour-contrast rule
// probes (via getContext) while checking for icon-font ligatures. Without
// this, every axe() scan over an element containing an icon logs a noisy
// "Not implemented" error to stderr (harmless — axe catches it and the
// scan result is unaffected), so stub it out.
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
