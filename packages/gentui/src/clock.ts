// Injectable timer source. The runtime never calls the global timers directly so
// wait/timeout behavior can be driven deterministically by a fake clock in tests.

export type TimerId = number;

export interface RuntimeClock {
  /** Schedule `fn` to run after `ms` milliseconds; returns a cancellable id. */
  setTimeout(fn: () => void, ms: number): TimerId;
  /** Cancel a scheduled timer. */
  clear(id: TimerId): void;
}

/** The default clock, backed by the platform's real timers. */
export const realClock: RuntimeClock = {
  setTimeout(fn: () => void, ms: number): TimerId {
    return Number(setTimeout(fn, ms));
  },
  clear(id: TimerId): void {
    clearTimeout(id);
  },
};
