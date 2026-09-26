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

// jsdom doesn't implement pointer capture or scrollIntoView, which Radix
// UI's <Select> (used e.g. by PortfolioPage's vacancy picker) relies on
// internally to drive its open/close and item-scroll behavior via real
// pointer events. Without these, clicking a <Select> in a test crashes with
// "target.hasPointerCapture is not a function".
if (typeof Element.prototype.hasPointerCapture !== "function") {
  Element.prototype.hasPointerCapture = () => false;
}
if (typeof Element.prototype.setPointerCapture !== "function") {
  Element.prototype.setPointerCapture = () => {};
}
if (typeof Element.prototype.releasePointerCapture !== "function") {
  Element.prototype.releasePointerCapture = () => {};
}
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}

// jsdom doesn't implement the Blob URL registry, which pages use to trigger
// a client-side file download (e.g. PortfolioPage/FitGapReportPage's PDF/
// JSON export buttons). Without this, any test that exercises an export
// button throws an unhandled "URL.createObjectURL is not a function".
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = () => "blob:mock-url";
}
if (typeof URL.revokeObjectURL !== "function") {
  URL.revokeObjectURL = () => {};
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
