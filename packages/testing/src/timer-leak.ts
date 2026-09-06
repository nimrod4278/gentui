// Detects timers created but never cleared inside a scoped window.
//
// `install()` patches the global timer functions to track live handles;
// `assertNoLeaks()` throws if any remain; `restore()` un-patches and cancels
// any still-pending tracked timers so the detector never leaks into the run.

type TimerHandle = ReturnType<typeof setTimeout>;

interface TrackedTimer {
  kind: "timeout" | "interval";
  delay: number;
}

interface Originals {
  setTimeout: typeof setTimeout;
  setInterval: typeof setInterval;
  clearTimeout: typeof clearTimeout;
  clearInterval: typeof clearInterval;
}

export class TimerLeakDetector {
  #active = new Map<TimerHandle, TrackedTimer>();
  #orig: Originals | undefined;

  install(): void {
    if (this.#orig) return;
    const orig: Originals = {
      setTimeout: globalThis.setTimeout,
      setInterval: globalThis.setInterval,
      clearTimeout: globalThis.clearTimeout,
      clearInterval: globalThis.clearInterval,
    };
    this.#orig = orig;
    const active = this.#active;

    globalThis.setTimeout = ((fn: Callback, delay?: number, ...args: unknown[]) => {
      const handle = orig.setTimeout(fn as never, delay, ...args);
      active.set(handle, { kind: "timeout", delay: Number(delay) || 0 });
      return handle;
    }) as typeof setTimeout;

    globalThis.setInterval = ((fn: Callback, delay?: number, ...args: unknown[]) => {
      const handle = orig.setInterval(fn as never, delay, ...args);
      active.set(handle, { kind: "interval", delay: Number(delay) || 0 });
      return handle;
    }) as typeof setInterval;

    globalThis.clearTimeout = ((handle?: TimerHandle) => {
      if (handle != null) active.delete(handle);
      return orig.clearTimeout(handle as never);
    }) as typeof clearTimeout;

    globalThis.clearInterval = ((handle?: TimerHandle) => {
      if (handle != null) active.delete(handle);
      return orig.clearInterval(handle as never);
    }) as typeof clearInterval;
  }

  activeCount(): number {
    return this.#active.size;
  }

  assertNoLeaks(): void {
    if (this.#active.size === 0) return;
    const details = [...this.#active.values()]
      .map((t) => `${t.kind}(${t.delay}ms)`)
      .join(", ");
    throw new Error(`Detected ${this.#active.size} leaked timer(s): ${details}`);
  }

  restore(): void {
    const orig = this.#orig;
    if (!orig) return;
    for (const handle of this.#active.keys()) {
      orig.clearTimeout(handle as never);
      orig.clearInterval(handle as never);
    }
    globalThis.setTimeout = orig.setTimeout;
    globalThis.setInterval = orig.setInterval;
    globalThis.clearTimeout = orig.clearTimeout;
    globalThis.clearInterval = orig.clearInterval;
    this.#orig = undefined;
    this.#active.clear();
  }
}

type Callback = (...args: unknown[]) => void;
