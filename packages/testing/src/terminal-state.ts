// Detects a terminal left in a modified mode (e.g. raw mode not restored).
//
// Model the terminal as a tty-like descriptor so the guard can be
// unit-tested without a real pseudo-terminal; the real PTY integration in a
// later slice reuses the same capture/diff contract.

export interface TtyLike {
  isRaw?: boolean;
  isTTY?: boolean;
}

export interface TerminalSnapshot {
  isRaw: boolean;
}

export class TerminalStateGuard {
  #ref: TtyLike;
  #snapshot?: TerminalSnapshot;

  constructor(ref: TtyLike) {
    this.#ref = ref;
  }

  capture(): TerminalSnapshot {
    this.#snapshot = { isRaw: Boolean(this.#ref.isRaw) };
    return this.#snapshot;
  }

  diff(): { changed: boolean; before: TerminalSnapshot; after: TerminalSnapshot } {
    if (!this.#snapshot) throw new Error("call capture() before diff()");
    const after: TerminalSnapshot = { isRaw: Boolean(this.#ref.isRaw) };
    return { changed: after.isRaw !== this.#snapshot.isRaw, before: this.#snapshot, after };
  }

  assertRestored(): void {
    const { changed, before, after } = this.diff();
    if (changed) {
      throw new Error(
        `Terminal mode not restored: isRaw ${before.isRaw} -> ${after.isRaw}`,
      );
    }
  }
}
