import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePolling } from "./usePolling";

describe("usePolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("doubles the backoff interval on each consecutive failure, up to the 60s ceiling", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => usePolling(fn, 5000, true));

    expect(result.current.intervalMs).toBe(5000);

    // Attempt 1 at 5s — fails, backoff doubles to 10s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.current.failureCount).toBe(1);
    expect(result.current.intervalMs).toBe(10000);

    // Attempt 2 at +10s — fails, backoff doubles to 20s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(result.current.failureCount).toBe(2);
    expect(result.current.intervalMs).toBe(20000);

    // Attempt 3 at +20s — fails, backoff doubles to 40s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(fn).toHaveBeenCalledTimes(3);
    expect(result.current.failureCount).toBe(3);
    expect(result.current.intervalMs).toBe(40000);

    // Attempt 4 at +40s — fails; 8x base would be 80s, capped at 60s ceiling.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40000);
    });
    expect(fn).toHaveBeenCalledTimes(4);
    expect(result.current.failureCount).toBe(4);
    expect(result.current.intervalMs).toBe(60000);
    expect(result.current.isStalled).toBe(false);
  });

  it("stops automatically after 5 consecutive failures and exposes the stalled flag", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => usePolling(fn, 1000, true));

    // Drive through failures 1-4 (each schedules the next attempt).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000); // attempt 1 fails -> next at 2s
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000); // attempt 2 fails -> next at 4s
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000); // attempt 3 fails -> next at 8s
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000); // attempt 4 fails -> next at 16s
    });
    expect(fn).toHaveBeenCalledTimes(4);
    expect(result.current.isStalled).toBe(false);

    // 5th consecutive failure — polling stops automatically.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16000);
    });
    expect(fn).toHaveBeenCalledTimes(5);
    expect(result.current.failureCount).toBe(5);
    expect(result.current.isStalled).toBe(true);

    // No further attempts are scheduled once stalled.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it("resets the failure count and resumes at the base interval on manual retry from stalled", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => usePolling(fn, 1000, true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000); // 1
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000); // 2
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000); // 3
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000); // 4
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16000); // 5 -> stalled
    });
    expect(result.current.isStalled).toBe(true);
    expect(fn).toHaveBeenCalledTimes(5);

    // Manual retry: resets failure count, makes an immediate attempt, still fails.
    fn.mockRejectedValueOnce(new Error("still down"));
    await act(async () => {
      result.current.retry();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fn).toHaveBeenCalledTimes(6);
    expect(result.current.isStalled).toBe(false);
    expect(result.current.failureCount).toBe(1);
    expect(result.current.intervalMs).toBe(2000);

    // The next scheduled attempt after retry resumes doubling from the base.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fn).toHaveBeenCalledTimes(7);
  });

  it("resets to the base interval immediately on a success mid-backoff", async () => {
    const fn = vi.fn();
    fn.mockRejectedValueOnce(new Error("boom"));
    fn.mockRejectedValueOnce(new Error("boom"));
    fn.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => usePolling(fn, 1000, true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000); // fails -> next at 2s
    });
    expect(result.current.failureCount).toBe(1);
    expect(result.current.intervalMs).toBe(2000);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000); // fails -> next at 4s
    });
    expect(result.current.failureCount).toBe(2);
    expect(result.current.intervalMs).toBe(4000);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000); // succeeds -> resets to base immediately
    });
    expect(fn).toHaveBeenCalledTimes(3);
    expect(result.current.failureCount).toBe(0);
    expect(result.current.intervalMs).toBe(1000);
    expect(result.current.isStalled).toBe(false);
  });

  it("does not poll while inactive, and stops polling when active becomes false", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ active }) => usePolling(fn, 1000, active), {
      initialProps: { active: false },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fn).not.toHaveBeenCalled();

    rerender({ active: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fn).toHaveBeenCalledTimes(1);

    rerender({ active: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.current.isStalled).toBe(false);
  });
});
