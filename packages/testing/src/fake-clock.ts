// Deterministic virtual clock. Tests advance time explicitly instead of
// sleeping, so spinner/wait/timeout behavior is fast and reproducible.

type Callback = (...args: unknown[]) => void;

interface Scheduled {
  id: number;
  time: number;
  fn: Callback;
  args: unknown[];
  interval?: number;
}

export class FakeClock {
  #now: number;
  #seq = 0;
  #tasks: Scheduled[] = [];

  constructor(start = 0) {
    this.#now = start;
  }

  now(): number {
    return this.#now;
  }

  pending(): number {
    return this.#tasks.length;
  }

  setTimeout(fn: Callback, delay = 0, ...args: unknown[]): number {
    const id = ++this.#seq;
    this.#tasks.push({ id, time: this.#now + Math.max(0, delay), fn, args });
    return id;
  }

  setInterval(fn: Callback, delay = 1, ...args: unknown[]): number {
    const id = ++this.#seq;
    const period = Math.max(1, delay);
    this.#tasks.push({ id, time: this.#now + period, fn, args, interval: period });
    return id;
  }

  clear(id: number): void {
    this.#tasks = this.#tasks.filter((t) => t.id !== id);
  }

  /** Advance virtual time by `ms`, firing due callbacks in time/insertion order. */
  advance(ms: number): number {
    if (ms < 0) throw new RangeError(`cannot advance by a negative amount: ${ms}`);
    const target = this.#now + ms;
    for (;;) {
      const due = this.#tasks
        .filter((t) => t.time <= target)
        .sort((a, b) => a.time - b.time || a.id - b.id)[0];
      if (!due) break;
      this.#now = due.time;
      if (due.interval !== undefined) {
        due.time += due.interval;
      } else {
        this.#tasks = this.#tasks.filter((t) => t !== due);
      }
      due.fn(...due.args);
    }
    this.#now = target;
    return this.#now;
  }
}
