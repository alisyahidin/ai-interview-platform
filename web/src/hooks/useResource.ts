import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import type { ResourceState } from "@/types";

export interface UseResourceOptions<T> {
  /** A successful response satisfying this predicate resolves to "empty" instead of "ready". */
  isEmpty?: (data: T) => boolean;
  /** Skip fetching entirely (e.g. a required param isn't known yet). Defaults to true. */
  enabled?: boolean;
}

export interface UseResourceResult<T> {
  resource: ResourceState<T>;
  /** Re-runs the fetch from "loading", e.g. for a manual "Retry" action. */
  refetch: () => void;
}

/**
 * Runs `fetcher` and maps the outcome to the `ResourceState` union that
 * `<Resource>` (see components/resource/Resource.tsx) renders: a 404 becomes
 * "not-found", a 403 becomes "forbidden", any other failure (network error,
 * 5xx, ...) becomes "error", a response satisfying `isEmpty` becomes "empty",
 * otherwise "ready".
 *
 * 401 is deliberately not distinguished here — it's handled globally by
 * `api.ts`'s response interceptor (hard redirect to /login), so by the time
 * a 401 rejection would reach this hook the app is already navigating away.
 */
export function useResource<T>(
  fetcher: () => Promise<{ data: T }>,
  options: UseResourceOptions<T> = {}
): UseResourceResult<T> {
  const { enabled = true } = options;
  const [resource, setResource] = useState<ResourceState<T>>({ status: "loading" });
  const [version, setVersion] = useState(0);

  // Ref-captured so callers can pass fresh inline functions each render
  // without retriggering the effect (only `enabled`/`version` should).
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const isEmptyRef = useRef(options.isEmpty);
  isEmptyRef.current = options.isEmpty;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setResource({ status: "loading" });

    fetcherRef
      .current()
      .then((response) => {
        if (cancelled) return;
        const data = response.data;
        const empty = isEmptyRef.current?.(data) ?? false;
        setResource(empty ? { status: "empty" } : { status: "ready", data });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          if (status === 404) {
            setResource({ status: "not-found" });
            return;
          }
          if (status === 403) {
            setResource({ status: "forbidden" });
            return;
          }
        }
        setResource({ status: "error", error });
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, version]);

  const refetch = useCallback(() => setVersion((v) => v + 1), []);

  return { resource, refetch };
}
