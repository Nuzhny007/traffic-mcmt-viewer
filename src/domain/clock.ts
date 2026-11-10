/**
 * Monotonic clock used by everything that measures elapsed live-feed time.
 *
 * `Date.now()` jumps when the host clock is adjusted (NTP, manual change), which
 * would make track ages negative or make stale tracks look fresh. Elapsed time
 * between two samples of this clock is always meaningful.
 */
export function nowMs(): number {
  return performance.now();
}
