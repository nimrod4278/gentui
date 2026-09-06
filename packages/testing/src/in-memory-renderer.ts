// Test-facing aliases over the production deterministic text renderer. Keeping
// the implementation in gentui lets real host adapters render without a
// runtime dependency on gentui-testing.
import { createTextRenderer } from "gentui";
import type { InteractionState, RendererInput, RendererKey, TextRenderer } from "gentui";

export type InMemoryRendererOptions = Parameters<typeof createTextRenderer>[0];
export type InMemoryRenderer = TextRenderer;

export interface TestRendererDriver {
  dispatch(input: RendererInput): Promise<ReturnType<InMemoryRenderer["dispatch"]>>;
  activate(nodeId: string): Promise<ReturnType<InMemoryRenderer["dispatch"]>>;
  requestCancel(reason?: string): Promise<ReturnType<InMemoryRenderer["dispatch"]>>;
  setInteractionState(state: Partial<InteractionState>): Promise<ReturnType<InMemoryRenderer["dispatch"]>>;
  press(key: RendererKey): Promise<ReturnType<InMemoryRenderer["dispatch"]>>;
}

export const createInMemoryRenderer = createTextRenderer;

export function createTestRenderer(): { renderer: InMemoryRenderer; driver: TestRendererDriver } {
  const renderer = createInMemoryRenderer();
  const driver: TestRendererDriver = {
    dispatch: (input) => Promise.resolve(renderer.dispatch(input)),
    activate: (nodeId) => Promise.resolve(renderer.dispatch({ type: "activate", nodeId })),
    requestCancel: (reason) => Promise.resolve(renderer.dispatch(reason !== undefined
      ? { type: "cancel-request", reason }
      : { type: "cancel-request" })),
    setInteractionState: (state) => Promise.resolve(renderer.dispatch({ type: "state-change", state })),
    press: (key) => Promise.resolve(renderer.dispatch({ type: "key", key })),
  };
  return { renderer, driver };
}
