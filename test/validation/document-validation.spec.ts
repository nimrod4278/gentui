import { describe, it, expect } from "vitest";
import {
  validateDocument,
  DiagnosticCode,
  DocumentInvalidError,
  createRuntime,
  type DocumentLimits,
  type UiNode,
  type ValidationDiagnostic,
} from "gentui";
import { createInMemoryRenderer } from "gentui-testing";

// --- helpers ---------------------------------------------------------------

function validText(content = "hi"): UiNode {
  return { id: "root", type: "text", props: { content } };
}

function find(
  diagnostics: ValidationDiagnostic[],
  code: string,
): ValidationDiagnostic | undefined {
  return diagnostics.find((d) => d.code === code);
}

function diagnosticsFor(input: unknown, limits?: Partial<DocumentLimits>): ValidationDiagnostic[] {
  const result = validateDocument(input, limits ? { limits: limits as DocumentLimits } : undefined);
  if (result.ok) throw new Error("expected document to be rejected but it was accepted");
  return result.diagnostics;
}

/** A chain `stack > stack > ... > text` exactly `depth` nodes deep. */
function nestedChain(depth: number): UiNode {
  let node: UiNode = { id: "n0", type: "text", props: { content: "x" } };
  for (let i = 1; i < depth; i++) {
    node = { id: `n${i}`, type: "stack", props: {}, children: [node] };
  }
  return node;
}

// --- tests -----------------------------------------------------------------

describe("document validation", () => {
  it("accepts a minimal valid protocol-v1 document", () => {
    const result = validateDocument({ version: "1", id: "doc", root: validText() });
    expect(result.ok).toBe(true);
  });

  it("1. rejects an unsupported protocol version with a stable code and root path", () => {
    const diags = diagnosticsFor({ version: "2", id: "doc", root: validText() });
    const diag = find(diags, DiagnosticCode.UnsupportedVersion);
    expect(diag).toBeDefined();
    expect(diag!.path).toEqual(["version"]);
  });

  it("2. rejects duplicate node ids", () => {
    const doc = {
      version: "1",
      id: "doc",
      root: {
        id: "dup",
        type: "stack",
        props: {},
        children: [{ id: "dup", type: "text", props: { content: "x" } }],
      },
    };
    const diag = find(diagnosticsFor(doc), DiagnosticCode.DuplicateId);
    expect(diag).toBeDefined();
    expect(diag!.path).toEqual(["root", "children", 0]);
  });

  it("3. rejects an unknown node type and an unknown prop", () => {
    const unknownType = diagnosticsFor({
      version: "1",
      id: "doc",
      root: { id: "root", type: "mystery", props: {} },
    });
    const typeDiag = find(unknownType, DiagnosticCode.UnknownNodeType);
    expect(typeDiag).toBeDefined();
    expect(typeDiag!.path).toEqual(["root", "type"]);

    const unknownProp = diagnosticsFor({
      version: "1",
      id: "doc",
      root: { id: "root", type: "text", props: { content: "x", sparkle: true } },
    });
    const propDiag = find(unknownProp, DiagnosticCode.UnknownProp);
    expect(propDiag).toBeDefined();
    expect(propDiag!.path).toEqual(["root", "props", "sparkle"]);
  });

  it("4. rejects a child under a leaf node at the exact child path", () => {
    const doc = {
      version: "1",
      id: "doc",
      root: {
        id: "root",
        type: "text",
        props: { content: "x" },
        children: [{ id: "kid", type: "text", props: { content: "y" } }],
      },
    };
    const diag = find(diagnosticsFor(doc), DiagnosticCode.ChildrenNotAllowed);
    expect(diag).toBeDefined();
    expect(diag!.path).toEqual(["root", "children"]);
  });

  it("5. rejects a disallowed intent/event before dispatch", () => {
    const doc = {
      version: "1",
      id: "doc",
      root: {
        id: "root",
        type: "text",
        props: { content: "x" },
        events: { onClick: { name: "clicked" } },
      },
    };
    const diag = find(diagnosticsFor(doc), DiagnosticCode.DisallowedEvent);
    expect(diag).toBeDefined();
    expect(diag!.path).toEqual(["root", "events", "onClick"]);
  });

  describe("6. limit boundaries accept max and reject max+1", () => {
    it("depth", () => {
      const doc = { version: "1", id: "doc", root: nestedChain(4) };
      expect(validateDocument(doc, { limits: { ...huge, maxDepth: 4 } }).ok).toBe(true);
      const diag = find(
        diagnosticsFor(doc, { ...huge, maxDepth: 3 }),
        DiagnosticCode.MaxDepthExceeded,
      );
      expect(diag).toBeDefined();
    });

    it("node count", () => {
      const doc = { version: "1", id: "doc", root: nestedChain(4) }; // 4 nodes
      expect(validateDocument(doc, { limits: { ...huge, maxNodes: 4 } }).ok).toBe(true);
      const diag = find(
        diagnosticsFor(doc, { ...huge, maxNodes: 3 }),
        DiagnosticCode.MaxNodesExceeded,
      );
      expect(diag).toBeDefined();
    });

    it("text length", () => {
      const doc = { version: "1", id: "doc", root: validText("abcde") }; // 5 code points
      expect(validateDocument(doc, { limits: { ...huge, maxTextLength: 5 } }).ok).toBe(true);
      const diag = find(
        diagnosticsFor(doc, { ...huge, maxTextLength: 4 }),
        DiagnosticCode.MaxTextLengthExceeded,
      );
      expect(diag).toBeDefined();
    });

    it("bytes", () => {
      const doc = { version: "1", id: "doc", root: validText("abcde") };
      const bytes = Buffer.byteLength(JSON.stringify(doc), "utf8");
      expect(validateDocument(doc, { limits: { ...huge, maxBytes: bytes } }).ok).toBe(true);
      const diag = find(
        diagnosticsFor(doc, { ...huge, maxBytes: bytes - 1 }),
        DiagnosticCode.MaxBytesExceeded,
      );
      expect(diag).toBeDefined();
    });
  });

  it("7. returns a diagnostic for pathologically deep input instead of overflowing the stack", () => {
    const doc = { version: "1", id: "doc", root: nestedChain(20_000) };
    let result: ReturnType<typeof validateDocument>;
    expect(() => {
      result = validateDocument(doc); // default limits
    }).not.toThrow();
    expect(result!.ok).toBe(false);
    if (!result!.ok) {
      expect(find(result!.diagnostics, DiagnosticCode.MaxDepthExceeded)).toBeDefined();
    }
  });

  it("9. diagnostics do not echo a secret embedded in a rejected prop", () => {
    const secret = "sensitive-test-value-9d4f";
    const diags = diagnosticsFor({
      version: "1",
      id: "doc",
      root: { id: "root", type: "text", props: { content: 42, apiKey: secret } },
    });
    // Both an invalid prop and an unknown prop were rejected...
    expect(find(diags, DiagnosticCode.UnknownProp)).toBeDefined();
    // ...but no diagnostic echoes the secret value or the rejected numeric value.
    const serialized = JSON.stringify(diags);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("42");
  });

  describe("rejected before the renderer observes a commit", () => {
    it("open() rejects with diagnostics and never renders an invalid document", async () => {
      const renderer = createInMemoryRenderer();
      const runtime = createRuntime({ renderer });

      let error: unknown;
      try {
        await runtime.open({ document: { version: "9", id: "doc", root: validText() } as never });
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(DocumentInvalidError);
      expect((error as DocumentInvalidError).diagnostics.length).toBeGreaterThan(0);
      expect(renderer.frames).toHaveLength(0);
      expect(renderer.currentFrame).toBeUndefined();
    });
  });
});

// Limits large enough that only the field under test can trip.
const huge: DocumentLimits = {
  maxBytes: 10_000_000,
  maxDepth: 10_000,
  maxNodes: 1_000_000,
  maxTextLength: 1_000_000,
};
