import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import api from "@/services/api";
import { useResource } from "./useResource";

const API_BASE = "http://localhost:3001/api/v1";

describe("useResource", () => {
  it("maps a 404 to not-found", async () => {
    server.use(http.get(`${API_BASE}/thing`, () => new HttpResponse(null, { status: 404 })));
    const { result } = renderHook(() => useResource(() => api.get("/thing")));

    await waitFor(() => expect(result.current.resource.status).toBe("not-found"));
  });

  it("maps a 403 to forbidden", async () => {
    server.use(http.get(`${API_BASE}/thing`, () => new HttpResponse(null, { status: 403 })));
    const { result } = renderHook(() => useResource(() => api.get("/thing")));

    await waitFor(() => expect(result.current.resource.status).toBe("forbidden"));
  });

  it("maps a 500 to error", async () => {
    server.use(http.get(`${API_BASE}/thing`, () => new HttpResponse(null, { status: 500 })));
    const { result } = renderHook(() => useResource(() => api.get("/thing")));

    await waitFor(() => expect(result.current.resource.status).toBe("error"));
  });

  it("maps a network error to error", async () => {
    server.use(http.get(`${API_BASE}/thing`, () => HttpResponse.error()));
    const { result } = renderHook(() => useResource(() => api.get("/thing")));

    await waitFor(() => expect(result.current.resource.status).toBe("error"));
  });

  it("maps a successful empty collection to empty when isEmpty is satisfied", async () => {
    server.use(http.get(`${API_BASE}/things`, () => HttpResponse.json({ data: { items: [] } })));
    const { result } = renderHook(() =>
      useResource(() => api.get("/things"), { isEmpty: (data: { items: unknown[] }) => data.items.length === 0 })
    );

    await waitFor(() => expect(result.current.resource.status).toBe("empty"));
  });

  it("otherwise resolves to ready with the response data", async () => {
    server.use(http.get(`${API_BASE}/things`, () => HttpResponse.json({ data: { items: [1, 2] } })));
    const { result } = renderHook(() =>
      useResource(() => api.get("/things"), { isEmpty: (data: { items: unknown[] }) => data.items.length === 0 })
    );

    await waitFor(() => expect(result.current.resource.status).toBe("ready"));
    expect(result.current.resource).toMatchObject({ status: "ready", data: { items: [1, 2] } });
  });

  it("refetch re-runs the fetch from loading", async () => {
    let calls = 0;
    server.use(
      http.get(`${API_BASE}/thing`, () => {
        calls += 1;
        return calls === 1
          ? new HttpResponse(null, { status: 500 })
          : HttpResponse.json({ data: { ok: true } });
      })
    );
    const { result } = renderHook(() => useResource(() => api.get("/thing")));

    await waitFor(() => expect(result.current.resource.status).toBe("error"));

    act(() => result.current.refetch());

    await waitFor(() => expect(result.current.resource.status).toBe("ready"));
    expect(calls).toBe(2);
  });
});
