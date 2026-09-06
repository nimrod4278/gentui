// Neutralize terminal control sequences in untrusted text at the trusted
// rendering point. Dropping ESC and every C0/C1/DEL control byte defuses CSI
// and OSC sequences (their introducer is gone, leaving inert printable text),
// and dropping bidi/isolate format characters prevents visual reordering.
//
// The result contains only printable characters, so it cannot move the cursor,
// rewrite a line, or otherwise alter the frame structure it is placed into.
//
// Ranges are expressed as numeric code points (no embedded control literals).

const FORBIDDEN: ReadonlyArray<readonly [number, number]> = [
  [0x00, 0x1f], // C0 controls: NUL..US (incl. BEL, BS, TAB, LF, CR, ESC)
  [0x7f, 0x9f], // DEL and C1 controls
  [0x200e, 0x200f], // LRM, RLM
  [0x202a, 0x202e], // LRE, RLE, PDF, LRO, RLO
  [0x2066, 0x2069], // LRI, RLI, FSI, PDI
];

function isForbidden(codePoint: number): boolean {
  for (const [lo, hi] of FORBIDDEN) {
    if (codePoint >= lo && codePoint <= hi) return true;
  }
  return false;
}

export function sanitizeText(input: string): string {
  let out = "";
  for (const ch of input) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && isForbidden(cp)) continue;
    out += ch;
  }
  return out;
}
