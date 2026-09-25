import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import { clearToken, getStoredToken, saveToken } from "@/stores/authAtom";
import api from "./api";

const API_BASE = "http://localhost:3001/api/v1";

// jsdom doesn't implement real navigation, and `window.location`'s setter is
// typed as `string` (only a full `href` reassignment is legal), so the
// interceptor's `window.location.href = "/login"` can't be observed via the
// real object. Stub it with a plain writable object for the duration of
// these tests. Its `href` must stay a valid absolute URL going in — jsdom's
// XHR implementation resolves request URLs against it, and an empty/invalid
// value breaks the network request itself, not just this assertion.
const originalLocation = window.location;
const initialHref = originalLocation.href;

function stubLocation() {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, href: initialHref },
  });
}

function restoreLocation() {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
}

describe("api.ts response interceptor", () => {
  beforeEach(() => {
    saveToken("a-valid-token");
    stubLocation();
  });

  afterEach(() => {
    clearToken();
    restoreLocation();
    server.resetHandlers();
  });

  it("clears the token and redirects to /login on a 401 (regression: existing behavior)", async () => {
    server.use(http.get(`${API_BASE}/protected`, () => new HttpResponse(null, { status: 401 })));

    await expect(api.get("/protected")).rejects.toMatchObject({
      response: expect.objectContaining({ status: 401 }),
    });

    expect(getStoredToken()).toBeNull();
    expect(window.location.href).toBe("/login");
  });

  it("does not clear the token or redirect on a 403, and the rejection propagates", async () => {
    server.use(http.get(`${API_BASE}/protected`, () => new HttpResponse(null, { status: 403 })));

    await expect(api.get("/protected")).rejects.toMatchObject({
      response: expect.objectContaining({ status: 403 }),
    });

    expect(getStoredToken()).toBe("a-valid-token");
    expect(window.location.href).toBe(initialHref);
  });

  it("does not redirect on a 401 from the login request itself — wrong credentials, not an expired session", async () => {
    server.use(http.post(`${API_BASE}/auth/login`, () => new HttpResponse(null, { status: 401 })));

    await expect(api.post("/auth/login", { email: "x@example.com", password: "wrong" })).rejects.toMatchObject({
      response: expect.objectContaining({ status: 401 }),
    });

    // The token that existed before this failed login attempt is untouched,
    // and no navigation was forced — LoginPage's own catch block gets to
    // show its inline error instead of the whole page reloading out from
    // under it.
    expect(getStoredToken()).toBe("a-valid-token");
    expect(window.location.href).toBe(initialHref);
  });
});
