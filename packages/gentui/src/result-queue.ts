// Ordered in-memory result channel backing `session.wait()` and the legacy
// `session.results` async iteration.
//
// Results are FIFO and delivered at most once. `wait()`
// atomically drains all currently-queued results, or blocks (under an injected
// clock) until the first result, a timeout, an abort, or session close. Normal
// results are bounded by a capacity (backpressure, never dropped); one reserved
// slot always admits a terminal result (cancel/error) so it can be delivered
// even when the normal queue is full.

import type { UiResult } from "./protocol.js";
import type { RuntimeClock, TimerId } from "./clock.js";

/** Upper bound on `timeoutMs`; larger values are caller errors, not waits. */
export const MAX_WAIT_MS = 24 * 60 * 60 * 1000;

export interface WaitNotice {
  code: string;
  rejectedAttempts: number;
}

export interface WaitOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type WaitResult =
  | {
      status: "results";
      results: readonly [UiResult, ...UiResult[]];
      sessionState: "open" | "closed";
      notices?: WaitNotice[];
    }
  | { status: "timeout" }
  | { status: "interrupted"; reason: "aborted" }
  | { status: "closed" };

export interface OfferResult {
  accepted: boolean;
  pendingResults: number;
  capacity: number;
}

interface Waiter {
  mode: "all" | "one";
  resolveAll?: (r: WaitResult) => void;
  resolveOne?: (r: IteratorResult<UiResult>) => void;
  cleanup(): void;
}

function validateTimeout(ms: number): void {
  if (typeof ms !== "number" || !Number.isInteger(ms) || ms < 0 || ms > MAX_WAIT_MS) {
    throw new RangeError(`timeoutMs must be an integer in [0, ${MAX_WAIT_MS}], got ${ms}`);
  }
}

export class ResultChannel {
  #buffer: UiResult[] = [];
  #waiters: Waiter[] = [];
  #closed = false;
  #hasTerminal = false;
  #rejectedAttempts = 0;
  readonly #capacity: number;
  readonly #clock: RuntimeClock;

  constructor(options: { capacity: number; clock: RuntimeClock }) {
    this.#capacity = options.capacity;
    this.#clock = options.clock;
  }

  /** Enqueue a normal interaction result subject to capacity (backpressure). */
  offer(result: UiResult): OfferResult {
    if (this.#closed || this.#buffer.length >= this.#capacity) {
      this.#rejectedAttempts += 1;
      return { accepted: false, pendingResults: this.#buffer.length, capacity: this.#capacity };
    }
    this.#deliver(result, /* terminal */ false);
    return { accepted: true, pendingResults: this.#buffer.length, capacity: this.#capacity };
  }

  /** Enqueue the single terminal result and close the channel to new results. */
  offerTerminal(result: UiResult): void {
    if (this.#hasTerminal) return;
    this.#hasTerminal = true;
    this.#deliver(result, /* terminal */ true);
    this.#closed = true;
    this.#wakeOnClose();
  }

  wait(options: WaitOptions = {}): Promise<WaitResult> {
    const { timeoutMs, signal } = options;
    if (timeoutMs !== undefined) validateTimeout(timeoutMs);

    if (signal?.aborted) {
      return Promise.resolve({ status: "interrupted", reason: "aborted" });
    }
    if (this.#buffer.length > 0) {
      return Promise.resolve(this.#drainResults());
    }
    if (this.#closed) return Promise.resolve({ status: "closed" });
    if (timeoutMs === 0) return Promise.resolve({ status: "timeout" });

    return new Promise<WaitResult>((resolve) => {
      let timer: TimerId | undefined;
      const waiter: Waiter = {
        mode: "all",
        resolveAll: resolve,
        cleanup: () => {
          if (timer !== undefined) this.#clock.clear(timer);
          if (signal) signal.removeEventListener("abort", onAbort);
        },
      };
      const onAbort = (): void => {
        this.#removeWaiter(waiter);
        waiter.cleanup();
        resolve({ status: "interrupted", reason: "aborted" });
      };
      if (timeoutMs !== undefined) {
        timer = this.#clock.setTimeout(() => {
          this.#removeWaiter(waiter);
          waiter.cleanup();
          resolve({ status: "timeout" });
        }, timeoutMs);
      }
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
      this.#waiters.push(waiter);
    });
  }

  /** Host-initiated close: wake all pending waiters. */
  close(): void {
    this.#closed = true;
    this.#wakeOnClose();
  }

  [Symbol.asyncIterator](): AsyncIterator<UiResult> {
    return {
      next: (): Promise<IteratorResult<UiResult>> => {
        const buffered = this.#buffer.shift();
        if (buffered !== undefined) return Promise.resolve({ value: buffered, done: false });
        if (this.#closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise<IteratorResult<UiResult>>((resolve) => {
          this.#waiters.push({ mode: "one", resolveOne: resolve, cleanup: () => {} });
        });
      },
    };
  }

  #deliver(result: UiResult, terminal: boolean): void {
    const waiter = this.#waiters.shift();
    if (!waiter) {
      this.#buffer.push(result);
      return;
    }
    waiter.cleanup();
    if (waiter.mode === "one") {
      waiter.resolveOne!({ value: result, done: false });
    } else {
      waiter.resolveAll!({
        status: "results",
        results: [result],
        sessionState: terminal || this.#closed ? "closed" : "open",
        ...this.#takeNotices(),
      });
    }
  }

  #drainResults(): WaitResult {
    const results = this.#buffer.splice(0) as [UiResult, ...UiResult[]];
    return {
      status: "results",
      results,
      sessionState: this.#closed ? "closed" : "open",
      ...this.#takeNotices(),
    };
  }

  #wakeOnClose(): void {
    while (this.#waiters.length > 0) {
      const waiter = this.#waiters.shift()!;
      waiter.cleanup();
      if (waiter.mode === "one") {
        const buffered = this.#buffer.shift();
        if (buffered !== undefined) waiter.resolveOne!({ value: buffered, done: false });
        else waiter.resolveOne!({ value: undefined, done: true } as IteratorResult<UiResult>);
      } else if (this.#buffer.length > 0) {
        waiter.resolveAll!(this.#drainResults());
      } else {
        waiter.resolveAll!({ status: "closed" });
      }
    }
  }

  #removeWaiter(waiter: Waiter): void {
    const index = this.#waiters.indexOf(waiter);
    if (index >= 0) this.#waiters.splice(index, 1);
  }

  #takeNotices(): { notices?: WaitNotice[] } {
    if (this.#rejectedAttempts === 0) return {};
    const notices: WaitNotice[] = [
      { code: "result_backpressure", rejectedAttempts: this.#rejectedAttempts },
    ];
    this.#rejectedAttempts = 0;
    return { notices };
  }
}
