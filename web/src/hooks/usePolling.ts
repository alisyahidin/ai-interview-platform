import { useCallback, useEffect, useRef, useState } from "react";

/** Interval ceiling: backoff never waits longer than this between attempts. */
const MAX_INTERVAL_MS = 60_000;

/** After this many consecutive failures, polling stops automatically. */
const MAX_CONSECUTIVE_FAILURES = 5;

export interface UsePollingResult {
  /** Number of consecutive failures since the last success (or the last retry). */
  failureCount: number;
  /** The interval, in ms, that will be used for the next scheduled attempt. */
  intervalMs: number;
  /**
   * True once polling has stopped automatically after `MAX_CONSECUTIVE_FAILURES`
   * consecutive failures. No further attempts are made until `retry()` is called.
   */
  isStalled: boolean;
  /**
   * Resets the failure count and interval back to the base, immediately makes
   * one attempt, and resumes normal polling from there. Intended to back a
   * caller-rendered "Retry now" action once `isStalled` is true, but safe to
   * call any time polling is active.
   */
  retry: () => void;
}

/**
 * Polls `fn` on an interval while `active` is true, backing off on failure.
 *
 * Behavior: the first attempt fires after `baseIntervalMs`. Each consecutive
 * failure (a thrown error / rejected promise) doubles the wait for the next
 * attempt, up to a 60s ceiling. After 5 consecutive failures, polling stops
 * automatically and `isStalled` becomes true — call `retry()` to resume. Any
 * successful attempt resets the failure count and interval back to the base
 * immediately.
 */
export function usePolling(
  fn: () => void | Promise<void>,
  baseIntervalMs: number,
  active: boolean
): UsePollingResult {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const [failureCount, setFailureCount] = useState(0);
  const [intervalMs, setIntervalMs] = useState(baseIntervalMs);
  const [isStalled, setIsStalled] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped whenever the current polling "session" ends (deactivated, deps
  // changed, retried, unmounted) so a stale in-flight attempt's result is
  // ignored instead of resurrecting a cancelled schedule.
  const generationRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const attempt = useCallback(
    (generation: number) => {
      Promise.resolve()
        .then(() => fnRef.current())
        .then(() => {
          if (generation !== generationRef.current) return;
          setFailureCount(0);
          setIsStalled(false);
          setIntervalMs(baseIntervalMs);
          timerRef.current = setTimeout(() => attempt(generation), baseIntervalMs);
        })
        .catch(() => {
          if (generation !== generationRef.current) return;
          setFailureCount((prevFailures) => {
            const nextFailures = prevFailures + 1;
            if (nextFailures >= MAX_CONSECUTIVE_FAILURES) {
              setIsStalled(true);
              return nextFailures;
            }
            const nextInterval = Math.min(baseIntervalMs * 2 ** nextFailures, MAX_INTERVAL_MS);
            setIntervalMs(nextInterval);
            timerRef.current = setTimeout(() => attempt(generation), nextInterval);
            return nextFailures;
          });
        });
    },
    [baseIntervalMs]
  );

  const retry = useCallback(() => {
    clearTimer();
    generationRef.current += 1;
    const generation = generationRef.current;
    setFailureCount(0);
    setIsStalled(false);
    setIntervalMs(baseIntervalMs);
    attempt(generation);
  }, [attempt, baseIntervalMs, clearTimer]);

  useEffect(() => {
    clearTimer();
    generationRef.current += 1;
    setFailureCount(0);
    setIsStalled(false);
    setIntervalMs(baseIntervalMs);

    if (!active) return;

    const generation = generationRef.current;
    timerRef.current = setTimeout(() => attempt(generation), baseIntervalMs);

    return () => {
      generationRef.current += 1;
      clearTimer();
    };
  }, [active, baseIntervalMs, attempt, clearTimer]);

  return { failureCount, intervalMs, isStalled, retry };
}
