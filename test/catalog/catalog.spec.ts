import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildCatalog,
  standardCatalog,
  standardNodeRegistry,
  validateDocument,
  createRuntime,
  PROTOCOL_VERSION,
  CATALOG_VERSION,
  DEFAULT_LIMITS,
  DiagnosticCode,
  type UiCatalog,
  type UiDocument,
  type UiNode,
} from "gentui";
import { createInMemoryRenderer } from "gentui-testing";

function wrap(node: UiNode): UiDocument {
  return { version: "1", id: "doc", root: node };
}

const catalog: UiCatalog = standardCatalog;

describe("catalog discovery", () => {
  it("1. advertises every supported node's props, child policy, events, and an example, plus limits and theme", () => {
    // Every registry type appears exactly once, and vice versa.
    const catalogTypes = catalog.components.map((c) => c.type).sort();
    expect(catalogTypes).toEqual(Object.keys(standardNodeRegistry).sort());

    const text = catalog.components.find((c) => c.type === "text")!;
    expect(text.description).not.toBe("");
    expect(text.props).toEqual({ content: { type: "string", required: true } });
    expect(text.childPolicy).toBe("leaf");
    expect(text.allowedEvents).toEqual([]);
    expect(text.example).toMatchObject({ type: "text", props: { content: expect.any(String) } });

    const stack = catalog.components.find((c) => c.type === "stack")!;
    expect(stack.props).toEqual({});
    expect(stack.childPolicy).toBe("container");
    expect(stack.allowedEvents).toEqual([]);

    expect(catalog.limits).toEqual(DEFAULT_LIMITS);
    expect(catalog.theme.name).toBe("default");
    expect(catalog.theme.semanticVariants.length).toBeGreaterThan(0);
    expect(catalog.theme.semanticVariants).toContain("default");
  });

  it("2. every catalog example composes a document the runtime accepts", async () => {
    const renderer = createInMemoryRenderer();
    const runtime = createRuntime({ renderer });

    for (const component of catalog.components) {
      const result = validateDocument(wrap(component.example));
      expect(result.ok, `example for ${component.type} should validate`).toBe(true);
      // ...and actually opens through the real runtime.
      const session = await runtime.open({ document: wrap(component.example) });
      await session.close();
    }
  });

  it("3. mutating a catalog example to violate its advertised schema is rejected", () => {
    for (const component of catalog.components) {
      // Adding a non-advertised event is always rejected.
      const withEvent: UiNode = {
        ...component.example,
        events: { onBogus: { name: "bogus" } },
      };
      const eventResult = validateDocument(wrap(withEvent));
      expect(eventResult.ok, `bogus event on ${component.type}`).toBe(false);
      if (!eventResult.ok) {
        expect(eventResult.diagnostics.some((d) => d.code === DiagnosticCode.DisallowedEvent)).toBe(
          true,
        );
      }

      // Removing each required prop is rejected.
      for (const [prop, spec] of Object.entries(component.props)) {
        if (!spec.required) continue;
        const props = { ...(component.example.props as Record<string, unknown>) };
        delete props[prop];
        const missing: UiNode = { ...component.example, props };
        const result = validateDocument(wrap(missing));
        expect(result.ok, `missing required ${prop} on ${component.type}`).toBe(false);
        if (!result.ok) {
          expect(result.diagnostics.some((d) => d.code === DiagnosticCode.InvalidProp)).toBe(true);
        }
      }
    }
  });

  it("4. protocol and catalog versions are independent of the npm package version", () => {
    const pkgPath = fileURLToPath(new URL("../../packages/gentui/package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };

    expect(PROTOCOL_VERSION).toBe("1");
    expect(CATALOG_VERSION).toBe("1");
    expect(catalog.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(catalog.catalogVersion).toBe(CATALOG_VERSION);

    // The package version differs from both, proving the versions are not
    // derived from it.
    expect(pkg.version).not.toBe(PROTOCOL_VERSION);
    expect(pkg.version).not.toBe(CATALOG_VERSION);
  });

  it("5. an incompatible protocol version yields only a typed incompatibility diagnostic (no partial interpretation)", () => {
    const result = validateDocument({
      version: "2",
      id: "", // would otherwise be flagged
      root: { id: "x", type: "definitely-unknown", props: {} }, // would otherwise be flagged
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]!.code).toBe(DiagnosticCode.UnsupportedVersion);
    }
  });

  it("runtime.catalog() returns the same catalog data", () => {
    const runtime = createRuntime({ renderer: createInMemoryRenderer() });
    expect(runtime.catalog()).toEqual(buildCatalog());
  });
});
