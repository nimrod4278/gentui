import { describe, it, expect } from "vitest";
import { validateDocument, DocumentInvalidError, createRuntime } from "gentui";
import { createInMemoryRenderer, createSeededRandom } from "gentui-testing";
import type { SeededRandom } from "gentui-testing";

// A seeded generator runs >= 10,000 malformed JSON-compatible
// trees without an uncaught exception, timeout, or renderer commit.

const KEYS = ["version", "id", "root", "type", "props", "children", "events", "content", "x"];

function randomString(rng: SeededRandom): string {
  const len = rng.int(8);
  let out = "";
  for (let i = 0; i < len; i++) out += String.fromCharCode(97 + rng.int(26));
  return out;
}

function randomJson(rng: SeededRandom, depth: number): unknown {
  if (depth > 6 || rng.next() < 0.35) {
    switch (rng.int(4)) {
      case 0:
        return rng.int(1000);
      case 1:
        return randomString(rng);
      case 2:
        return rng.next() < 0.5;
      default:
        return null;
    }
  }
  if (rng.next() < 0.5) {
    return Array.from({ length: rng.int(4) }, () => randomJson(rng, depth + 1));
  }
  const obj: Record<string, unknown> = {};
  const count = rng.int(5);
  for (let i = 0; i < count; i++) obj[rng.pick(KEYS)] = randomJson(rng, depth + 1);
  if (rng.next() < 0.4) obj.version = rng.pick(["1", "2", 1, "v1"]);
  return obj;
}

describe("malformed-document fuzzing", () => {
  it("survives 10,000 generated trees with no exception and no renderer commit for invalid docs", async () => {
    const rng = createSeededRandom();
    const seed = rng.seed;
    const renderer = createInMemoryRenderer();
    const runtime = createRuntime({ renderer });

    let validCount = 0;

    for (let i = 0; i < 10_000; i++) {
      const tree = randomJson(rng, 0);

      let result: ReturnType<typeof validateDocument>;
      try {
        result = validateDocument(tree);
      } catch (cause) {
        throw new Error(`validateDocument threw on case #${i} (seed=${seed}): ${String(cause)}`);
      }

      if (result.ok) {
        const session = await runtime.open({ document: result.document });
        await session.close();
        validCount++;
      } else {
        let error: unknown;
        try {
          await runtime.open({ document: tree as never });
        } catch (e) {
          error = e;
        }
        if (!(error instanceof DocumentInvalidError)) {
          throw new Error(`expected DocumentInvalidError on case #${i} (seed=${seed})`);
        }
      }
    }

    // The renderer committed a frame only for documents that actually validated.
    expect(renderer.frames.length).toBe(validCount);
  });
});
