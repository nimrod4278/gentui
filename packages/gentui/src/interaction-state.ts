import type { UiDocument, UiNode } from "./protocol.js";
import { parseDiagnostics, parseFileList, parseSelectOptions } from "./content.js";

export type InteractionStateField = "focus" | "scroll" | "tabs" | "selection" | "cursor" | "values";

/** User-owned state that survives compatible document updates. */
export interface InteractionState {
  focusId?: string;
  scroll: Record<string, number>;
  activeTabId: Record<string, string>;
  selection: Record<string, string>;
  cursor: Record<string, number>;
  values: Record<string, unknown>;
}

export type InteractionStateUpdate = Partial<InteractionState>;
export interface InteractionReset {
  nodeIds?: string[];
  fields?: InteractionStateField[];
}

export const emptyInteractionState = (): InteractionState => ({
  scroll: {}, activeTabId: {}, selection: {}, cursor: {}, values: {},
});

const nodesById = (document: UiDocument): Map<string, UiNode> => {
  const result = new Map<string, UiNode>();
  const visit = (node: UiNode): void => {
    result.set(node.id, node);
    for (const child of node.children ?? []) visit(child);
  };
  visit(document.root);
  return result;
};

const compatible = (oldNode: UiNode | undefined, nextNode: UiNode | undefined): boolean =>
  oldNode !== undefined && nextNode !== undefined && oldNode.type === nextNode.type;

const preserveMap = <T>(source: Record<string, T>, oldNodes: Map<string, UiNode>, nextNodes: Map<string, UiNode>): Record<string, T> =>
  Object.fromEntries(Object.entries(source).filter(([id]) => compatible(oldNodes.get(id), nextNodes.get(id))));

const eligible = (node: UiNode): boolean =>
  node.events?.activate !== undefined && node.props.disabled !== true && node.props.hidden !== true;

/** Reconcile only state belonging to live nodes of the same type. */
export function reconcileInteractionState(
  previous: InteractionState,
  oldDocument: UiDocument,
  nextDocument: UiDocument,
  reset: InteractionReset = {},
): InteractionState {
  const oldNodes = nodesById(oldDocument);
  const nextNodes = nodesById(nextDocument);
  const resetIds = new Set(reset.nodeIds ?? []);
  const fields = new Set(reset.fields ?? []);
  const resetField = (id: string, field: InteractionStateField): boolean =>
    (resetIds.size === 0 && fields.has(field)) ||
    (resetIds.has(id) && (fields.size === 0 || fields.has(field)));
  const shouldKeep = (id: string, field: InteractionStateField): boolean =>
    !resetField(id, field) && compatible(oldNodes.get(id), nextNodes.get(id));

  let focusId = previous.focusId;
  const focused = focusId ? nextNodes.get(focusId) : undefined;
  if (!focused || !compatible(oldNodes.get(focusId!), focused) || !eligible(focused) || resetField(focusId!, "focus")) {
    const oldOrder = [...oldNodes.keys()];
    const oldIndex = focusId ? oldOrder.indexOf(focusId) : -1;
    const nextOrder = [...nextNodes.values()];
    const candidates = [
      ...nextOrder.slice(Math.max(0, oldIndex + 1)),
      ...nextOrder.slice(0, Math.max(0, oldIndex + 1)).reverse(),
    ].filter(eligible);
    focusId = candidates[0]?.id ?? (nextDocument.root.type !== "button" ? nextDocument.root.id : undefined);
  }

  const activeTabId: Record<string, string> = {};
  for (const [id, selectedId] of Object.entries(previous.activeTabId)) {
    if (!shouldKeep(id, "tabs")) continue;
    const oldTabs = oldNodes.get(id);
    const nextTabs = nextNodes.get(id);
    // State fields are intentionally generic: preserve values attached to
    // compatible non-tab nodes, while applying child-aware repair to tabs.
    if (oldTabs?.type !== "tabs" || nextTabs?.type !== "tabs") {
      activeTabId[id] = selectedId;
      continue;
    }
    if (!nextTabs.children?.length) continue;
    if (nextTabs.children.some((child) => child.id === selectedId)) {
      activeTabId[id] = selectedId;
      continue;
    }
    // Removed active tabs fall forward to the child now occupying their old
    // index, or backward to the final child when the removed tab was last.
    const oldIndex = Math.max(0, oldTabs.children?.findIndex((child) => child.id === selectedId) ?? 0);
    activeTabId[id] = nextTabs.children[Math.min(oldIndex, nextTabs.children.length - 1)]!.id;
  }

  for (const node of nextNodes.values()) {
    if (node.type === "tabs" && node.children?.length && activeTabId[node.id] === undefined) {
      activeTabId[node.id] = node.children[0]!.id;
    }
  }

  const selection = Object.fromEntries(Object.entries(preserveMap(previous.selection, oldNodes, nextNodes)).filter(([id]) => shouldKeep(id, "selection")));
  for (const [id, selectedId] of Object.entries(selection)) {
    const oldNode = oldNodes.get(id);
    const nextNode = nextNodes.get(id);
    if (!oldNode || !nextNode || oldNode.type !== nextNode.type || !["file-list", "diagnostics", "select"].includes(nextNode.type)) continue;
    const items = (node: UiNode) => node.type === "file-list" ? parseFileList(String(node.props.content ?? ""))
      : node.type === "select" ? parseSelectOptions(node.props.options).filter((option) => !option.disabled)
      : parseDiagnostics(String(node.props.content ?? ""));
    const oldItems = items(oldNode);
    const nextItems = items(nextNode);
    if (nextItems.some((item) => item.id === selectedId)) continue;
    if (nextItems.length === 0) {
      delete selection[id];
      continue;
    }
    const oldIndex = Math.max(0, oldItems.findIndex((item) => item.id === selectedId));
    selection[id] = nextItems[Math.min(oldIndex, nextItems.length - 1)]!.id;
  }

  for (const node of nextNodes.values()) {
    if (node.type === "select" && selection[node.id] === undefined) {
      const first = parseSelectOptions(node.props.options).find((option) => !option.disabled);
      if (first) selection[node.id] = first.id;
    }
  }

  const nextState: InteractionState = {
    scroll: Object.fromEntries(Object.entries(preserveMap(previous.scroll, oldNodes, nextNodes)).filter(([id]) => shouldKeep(id, "scroll"))),
    activeTabId,
    selection,
    cursor: Object.fromEntries(Object.entries(preserveMap(previous.cursor, oldNodes, nextNodes)).filter(([id]) => shouldKeep(id, "cursor"))),
    values: Object.fromEntries(Object.entries(preserveMap(previous.values, oldNodes, nextNodes)).filter(([id]) => shouldKeep(id, "values"))),
  };
  if (focusId !== undefined) nextState.focusId = focusId;

  const visible = new Set<string>();
  const visitVisible = (node: UiNode): void => {
    if (node.props.hidden === true) return;
    visible.add(node.id);
    let children = node.children ?? [];
    if (node.type === "tabs" && children.length > 0) {
      const selected = activeTabId[node.id];
      children = [children.find((child) => child.id === selected) ?? children[0]!];
    }
    for (const child of children) visitVisible(child);
  };
  visitVisible(nextDocument.root);
  if (nextState.focusId && !visible.has(nextState.focusId)) {
    nextState.focusId = [...nextNodes.values()].find((node) => visible.has(node.id) && eligible(node))?.id ?? nextDocument.root.id;
  }
  return nextState;
}

export function mergeInteractionState(previous: InteractionState, update: InteractionStateUpdate): InteractionState {
  return {
    ...previous,
    ...update,
    scroll: update.scroll ? { ...previous.scroll, ...update.scroll } : previous.scroll,
    activeTabId: update.activeTabId ? { ...previous.activeTabId, ...update.activeTabId } : previous.activeTabId,
    selection: update.selection ? { ...previous.selection, ...update.selection } : previous.selection,
    cursor: update.cursor ? { ...previous.cursor, ...update.cursor } : previous.cursor,
    values: update.values ? { ...previous.values, ...update.values } : previous.values,
  };
}
