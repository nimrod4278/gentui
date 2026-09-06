import type { TerminalProfile } from "gentui";

// Deterministic terminal profiles for tests.
export const STANDARD_PROFILE: TerminalProfile = { columns: 80, rows: 24 };
export const NARROW_PROFILE: TerminalProfile = { columns: 40, rows: 24 };
export const WIDE_PROFILE: TerminalProfile = { columns: 120, rows: 24 };
