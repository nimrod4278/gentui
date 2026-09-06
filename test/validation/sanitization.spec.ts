import { describe, it, expect } from "vitest";
import { sanitizeText, createRuntime, type UiDocument } from "gentui";
import { createInMemoryRenderer, STANDARD_PROFILE } from "gentui-testing";

// Hostile control sequences in text cannot alter the frame
// structure. Sanitization happens at the trusted rendering point.

const HOSTILE =
  "A\x1b[31mB" + // ESC + CSI colour
  "\r\nC" + // carriage return + newline
  "\x08D" + // backspace
  "\x1b]8;;http://evil.example\x1b\\E" + // OSC 8 hyperlink (ST = ESC \)
  "\x1b]52;c;ZXZpbAo=\x07F" + // OSC 52 clipboard (BEL-terminated)
  "‮G"; // RTL override (bidi)

const CONTROL_OR_BIDI = /[\x00-\x1f\x7f-\x9f‎‏‪-‮⁦-⁩]/;

describe("sanitizeText", () => {
  it("strips ESC, CR, BS, control bytes, and bidi controls", () => {
    const clean = sanitizeText(HOSTILE);
    expect(clean).not.toMatch(CONTROL_OR_BIDI);
    // The visible letters survive.
    for (const letter of ["A", "B", "C", "D", "E", "F", "G"]) {
      expect(clean).toContain(letter);
    }
  });

  it("is idempotent", () => {
    expect(sanitizeText(sanitizeText(HOSTILE))).toBe(sanitizeText(HOSTILE));
  });

  it("leaves ordinary text untouched", () => {
    expect(sanitizeText("Hello, world")).toBe("Hello, world");
  });
});

describe("hostile text cannot alter the rendered frame structure", () => {
  it("keeps frame dimensions and line lengths intact", () => {
    const renderer = createInMemoryRenderer();
    const frame = renderer.render({
      document: {
        version: "1",
        id: "doc",
        root: { id: "root", type: "text", props: { content: HOSTILE } },
      } satisfies UiDocument,
      profile: STANDARD_PROFILE,
    });

    expect(frame.rows).toBe(24);
    expect(frame.lines).toHaveLength(24);
    expect(frame.lines.every((line) => line.length === 80)).toBe(true);
    for (const line of frame.lines) {
      expect(line).not.toMatch(CONTROL_OR_BIDI);
    }
  });

  it("renders through the runtime without exposing control sequences", async () => {
    const renderer = createInMemoryRenderer();
    const runtime = createRuntime({ renderer });
    await runtime.open({
      document: {
        version: "1",
        id: "doc",
        root: { id: "root", type: "text", props: { content: HOSTILE } },
      },
    });
    expect(renderer.currentFrame!.lines[0]).not.toMatch(CONTROL_OR_BIDI);
  });
});
