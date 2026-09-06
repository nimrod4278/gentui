import { describe, expect, it } from "vitest";
import { createRuntime, emptyInteractionState } from "gentui";
import type { InteractionState, TerminalProfile, UiDocument, UiNode } from "gentui";
import { createInMemoryRenderer, createTestRenderer } from "gentui-testing";

const document = (root: UiNode): UiDocument => ({ version: "1", id: "content", root, metadata: { token: "metadata-secret-9" } });
const node = (type: string, content: string, extra: Record<string, unknown> = {}): UiNode => ({ id: type, type, props: { content, ...extra } });
const state = (partial: Partial<InteractionState> = {}): InteractionState => ({ ...emptyInteractionState(), ...partial });
const render = (root: UiNode, profile: TerminalProfile = { columns: 40, rows: 8 }, interaction?: InteractionState) =>
  createInMemoryRenderer().render({ document: document(root), profile, state: interaction });
const visible = (frame: ReturnType<typeof render>) => frame.lines.map((line) => line.trimEnd()).filter(Boolean);
const CONTROL = /[\x00-\x1f\x7f-\x9f]/;
const HOSTILE = "safe\u001b[31mRED\u001b[0m\u001b]8;;https://evil\u0007link\u001b]52;c;Y2xpcA==\u0007\rOVER\bX";

const contentTypes = ["text", "markdown", "file-list", "diff", "diagnostics"] as const;

describe.each(contentTypes)("%s common content contract", (type) => {
  const content = type === "file-list" ? `modified\tid-1\t${HOSTILE}`
    : type === "diagnostics" ? `error\tmain.ts:1:1\ttest\tE1\t${HOSTILE}` : HOSTILE;

  it("renders hostile terminal sequences as inert printable cells", () => {
    const frame = render(node(type, content), { columns: 24, rows: 4 });
    expect(frame.lines.every((line) => !CONTROL.test(line))).toBe(true);
    expect(frame.lines).toHaveLength(4);
    expect(frame.lines.every((line) => line.length === 24)).toBe(true);
  });

  it("bounds long content to the document and viewport", () => {
    const frame = render(node(type, `${"word ".repeat(500)}\n${"x".repeat(500)}`), { columns: 11, rows: 3 });
    expect(frame.lines).toHaveLength(3);
    expect(frame.lines.every((line) => line.length === 11)).toBe(true);
  });

  it("is understandable in Unicode, ASCII-only, color, and no-color profiles", () => {
    const root = node(type, type === "file-list" ? "added\tw\t界🙂é.ts" : type === "diagnostics" ? "warning\t界.ts:2\ttool\tW1\t🙂 é" : "界🙂é");
    const unicode = render(root, { columns: 40, rows: 3, color: true });
    const noColor = render(root, { columns: 40, rows: 3, color: false });
    const ascii = render(root, { columns: 40, rows: 3, asciiOnly: true, color: false });
    expect(visible(noColor)).toEqual(visible(unicode));
    expect(ascii.lines.join("")).toMatch(/^[\x20-\x7e]+$/);
    if (type === "file-list") expect(ascii.lines.join(" ")).toContain("A added");
    if (type === "diagnostics") expect(ascii.lines.join(" ")).toContain("WARNING");
  });

  it("preserves logical scroll position across resize and never renders metadata secrets", () => {
    const interaction = state({ scroll: { [type]: 2 } });
    const root = node(type, type === "file-list" ? "A\ta\ta\nM\tb\tb\nD\tc\tc\nR\td\td\told"
      : type === "diagnostics" ? "error\ta\ttool\t1\ta\nwarning\tb\ttool\t2\tb\ninfo\tc\ttool\t3\tc\ninfo\td\ttool\t4\td"
        : "line-a\nline-b\nline-c\nline-d");
    const short = render(root, { columns: 30, rows: 1 }, interaction);
    const tall = render(root, { columns: 30, rows: 3 }, interaction);
    expect(short.lines[0]).toBe(tall.lines[0]);
    expect(tall.lines.join("")).not.toContain("metadata-secret-9");
  });
});

describe("text content", () => {
  it("preserves spaces and newlines while neutralizing CR/BS overwrite attacks", () => {
    expect(visible(render(node("text", "one  two\nthree\rOVER\bX")))).toEqual(["one  two", "threeOVERX"]);
  });

  it("wraps a known sentence and hard-wraps a word wider than the viewport", () => {
    const sentence = visible(render(node("text", "one two three"), { columns: 6, rows: 4 }));
    expect(sentence).toEqual(["one", "two", "three"]);
    expect(sentence.join(" ")).toBe("one two three");
    expect(visible(render(node("text", "abcdefgh"), { columns: 4, rows: 3 }))).toEqual(["abcd", "efgh"]);
  });

  it("measures emoji, CJK, and combining graphemes in terminal cells", () => {
    expect(render(node("text", "🙂界éX"), { columns: 7, rows: 1 }).lines[0]).toBe("🙂界éX ");
    expect(render(node("text", "🙂界éX"), { columns: 5, rows: 2 }).lines.map((line) => line.trimEnd())).toEqual(["🙂界é", "X"]);
  });
});

describe("markdown content", () => {
  it("renders headings, lists, quotes, inline/code blocks, and links", () => {
    const fixture = "# Heading\n- item\n> quote\nUse `code` and [docs](https://example.test)\n```ts\nconst x = 1;\n```";
    expect(visible(render(node("markdown", fixture), { columns: 60, rows: 8 }))).toEqual([
      "Heading", "- item", "> quote", "Use code and docs (https://example.test)", "| const x = 1;",
    ]);
  });

  it("keeps HTML/scripts and OSC-bearing labels, URLs, and code inert", () => {
    const fixture = "<script>alert('x')</script>\n[x\u001b]52;c;bad\u0007](https://safe\u001b]8;;bad\u0007)\n```\n\u001b[31mcode\u001b[0m\n```";
    const lines = visible(render(node("markdown", fixture), { columns: 80, rows: 6 }));
    expect(lines[0]).toBe("<script>alert('x')</script>");
    expect(lines.every((line) => !CONTROL.test(line))).toBe(true);
    expect(lines.at(-1)).toContain("code");
  });

  it("wraps prose and code without formatting bleeding to following lines", () => {
    const lines = visible(render(node("markdown", "`abcdefgh` tail\n```\nabcdefgh\n```\nafter"), { columns: 5, rows: 8 }));
    expect(lines).toEqual(["abcde", "fgh", "tail", "| abc", "| def", "| gh", "after"]);
    expect(lines.every((line) => !CONTROL.test(line))).toBe(true);
  });
});

describe("file-list content", () => {
  const files = (order = ["a", "b", "c"]): string => order.map((id) => `${id === "a" ? "A" : id === "b" ? "M" : "D"}\t${id}\t${id === "a" ? "space name.ts" : id === "b" ? "-界🙂.ts" : "bad\u001b[2J.ts"}`).join("\n");
  const fileDocument = (content: string): UiDocument => ({ version: "1", id: "files", root: {
    id: "files", type: "file-list", props: { label: "Changed files", content }, events: { activate: { name: "choose" } },
  } });

  it("navigates inert unusual paths and returns selected data without filesystem access", async () => {
    const { renderer, driver } = createTestRenderer();
    const session = await createRuntime({ renderer, profile: { columns: 60, rows: 4 } }).open({ document: fileDocument(files()) });
    await driver.press("Tab");
    await driver.press("ArrowDown");
    expect(renderer.currentFrame?.lines.join(" ")).toContain("> [M modified] -界🙂.ts");
    await driver.press("Enter");
    expect(await session.wait()).toMatchObject({ results: [{ type: "select", intent: "choose", value: { id: "b", path: "-界🙂.ts", status: "modified" } }] });
    await session.close();
  });

  it("preserves selection by stable ID after reorder and uses positional fallback after removal", async () => {
    const { renderer, driver } = createTestRenderer();
    const session = await createRuntime({ renderer }).open({ document: fileDocument(files()) });
    await driver.setInteractionState({ focusId: "files", selection: { files: "b" } });
    await session.update({ sessionId: session.id, sequence: 1, document: fileDocument(files(["c", "b", "a"])) });
    expect(renderer.currentInteractionState?.selection.files).toBe("b");
    await session.update({ sessionId: session.id, sequence: 2, document: fileDocument(files(["c", "a"])) });
    expect(renderer.currentInteractionState?.selection.files).toBe("a");
    await session.close();
  });

  it("distinguishes all statuses without relying on color and sanitizes labels", () => {
    const content = "A\ta\ta.ts\nM\tm\tm.ts\nD\td\td.ts\nR\tr\tnew.ts\told.ts";
    expect(visible(render(node("file-list", content), { columns: 50, rows: 6, color: false }))).toEqual([
      "> [A added] a.ts", "  [M modified] m.ts", "  [D deleted] d.ts", "  [R renamed] new.ts <- old.ts",
    ]);
  });
});

describe("diff content", () => {
  const fixture = "@@ -10,3 +20,3 @@ function\n context\n-old 界\n+new\t🙂\n\\ No newline at end of file";

  it("renders aligned context, additions, deletions, hunk headers, tabs, and no-newline markers", () => {
    expect(visible(render(node("diff", fixture), { columns: 50, rows: 8, color: false }))).toEqual([
      "@@ 10 -> 20 @@ function", "  10   20   context", "  11      - old 界", "       21 + new    🙂", "! No newline at end of file",
    ]);
  });

  it("retains +/- meaning in ASCII/no-color mode and bounds extremely long hostile lines", () => {
    const frame = render(node("diff", `+${"x".repeat(1000)}\u001b]52;c;bad\u0007\n-${"界".repeat(100)}`), { columns: 20, rows: 4, asciiOnly: true, color: false });
    expect(frame.lines).toHaveLength(4);
    expect(frame.lines.every((line) => line.length === 20)).toBe(true);
    expect(frame.lines.join("")).not.toMatch(CONTROL);
    expect(frame.lines[0]).toContain("+");
  });
});

describe("diagnostics content", () => {
  it("sorts severity/location and renders complete and missing fields with non-color labels", () => {
    const fixture = "info\tz.ts:9\ttool\tI1\tnote\nerror\tb.ts:2:3\ttsc\tTS1\tfailure words wrap here\nwarning\t\t\t\tcareful";
    const lines = visible(render(node("diagnostics", fixture), { columns: 40, rows: 8, color: false }));
    expect(lines).toEqual(["[ERROR] b.ts:2:3 tsc TS1: failure words", "wrap here", "[WARNING] careful", "[INFO] z.ts:9 tool I1: note"]);
  });

  it("preserves a selected diagnostic by stable derived ID after updates and sanitizes tool output", async () => {
    const first = "warning\tb.ts:2\tlint\tW1\tsecond\nerror\ta.ts:1\ttsc\tE1\tfirst";
    const selected = "b.ts:2:lint:W1:second";
    const oldDocument = document(node("diagnostics", first));
    const nextDocument = document(node("diagnostics", `${first}\ninfo\tc.ts\ttest\tI1\tnew\u001b[2J`));
    const { renderer, driver } = createTestRenderer();
    const session = await createRuntime({ renderer }).open({ document: oldDocument });
    await driver.setInteractionState({ selection: { diagnostics: selected } });
    await session.update({ sessionId: session.id, sequence: 1, document: nextDocument });
    expect(renderer.currentInteractionState?.selection.diagnostics).toBe(selected);
    expect(renderer.currentFrame?.lines.join("")).not.toMatch(CONTROL);
    await session.close();
  });
});
