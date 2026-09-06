import { describe, it, expect } from "vitest";
import { applyPatch } from "gentui";
import type { UiDocument, UiNode, UiPatchOp } from "gentui";
import { createSeededRandom } from "gentui-testing";

// Generated valid patch sequences produce the same final
// document as independently applying the equivalent changes through a simple,
// independent reference model (a plain-array reducer that shares no code with the
// production path-based patcher).

interface Item {
  id: string;
  content: string;
}

const asDocument = (items: Item[]): UiDocument => ({
  version: "1",
  id: "doc",
  root: {
    id: "root",
    type: "stack",
    props: {},
    children: items.map((it) => ({ id: it.id, type: "text", props: { content: it.content } })),
  },
});

const itemsOf = (document: UiDocument): Item[] =>
  (document.root.children ?? []).map((c: UiNode) => ({ id: c.id, content: String(c.props.content) }));

describe("patch reference-model equivalence", () => {
  it("chained valid patches match an independent array reducer", () => {
    const rng = createSeededRandom();
    const seed = rng.seed;

    for (let trial = 0; trial < 500; trial++) {
      // Independent reference state and the production document, started identical.
      const initial: Item[] = Array.from({ length: 1 + rng.int(4) }, (_, i) => ({
        id: `n${i}`,
        content: `c${i}`,
      }));
      let model = [...initial];
      let document = asDocument(initial);
      let nextId = initial.length;

      const steps = 1 + rng.int(8);
      for (let s = 0; s < steps; s++) {
        let op: UiPatchOp;
        if (model.length > 0 && rng.next() < 0.4) {
          // remove a valid index
          const index = rng.int(model.length);
          op = { type: "remove", path: ["root", "children", index] };
          model.splice(index, 1);
        } else {
          // set (overwrite or append) a fresh text node at a valid index
          const index = rng.int(model.length + 1);
          const item: Item = { id: `n${nextId++}`, content: `c${rng.int(1000)}` };
          op = {
            type: "set",
            path: ["root", "children", index],
            value: { id: item.id, type: "text", props: { content: item.content } },
          };
          if (index === model.length) model.push(item);
          else model[index] = item;
        }

        const applied = applyPatch(document, [op]);
        if (!applied.ok) {
          throw new Error(`valid op unexpectedly rejected (seed=${seed}, trial=${trial}, step=${s})`);
        }
        document = applied.document;

        // The production result must match the independent model at every step.
        expect(itemsOf(document), `seed=${seed} trial=${trial} step=${s}`).toEqual(model);
      }
    }
  });
});
