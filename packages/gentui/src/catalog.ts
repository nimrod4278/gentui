// Serialized catalog: what a host advertises to an agent so it can discover
// exactly which node types, props, events, limits, and theme variants are
// available. Built from the SAME node registry that validation uses, so the
// catalog and the validator cannot disagree.

import { PROTOCOL_VERSION } from "./version.js";
import { DEFAULT_LIMITS, type DocumentLimits } from "./limits.js";
import {
  standardNodeRegistry,
  type ChildPolicy,
  type NodeRegistry,
} from "./node-registry.js";
import type { UiNode } from "./protocol.js";

// Independent of both the protocol version and the npm package version.
export const CATALOG_VERSION = "1" as const;

export interface Theme {
  name: string;
  semanticVariants: string[];
}

export const DEFAULT_THEME: Theme = {
  name: "default",
  semanticVariants: ["default", "muted", "info", "success", "warning", "danger"],
};

export interface CatalogPropDescriptor {
  type: "string" | "boolean" | "number" | "json";
  required: boolean;
  minimum?: number;
  maximum?: number;
  integer?: boolean;
}

export interface CatalogComponent {
  type: string;
  description: string;
  props: Record<string, CatalogPropDescriptor>;
  childPolicy: ChildPolicy;
  allowedEvents: string[];
  example: UiNode;
  accessibleLabelProp?: string;
  keyboard?: string[];
}

export interface UiCatalog {
  protocolVersion: typeof PROTOCOL_VERSION;
  catalogVersion: typeof CATALOG_VERSION;
  components: CatalogComponent[];
  limits: DocumentLimits;
  theme: Theme;
}

export interface BuildCatalogOptions {
  registry?: NodeRegistry;
  limits?: DocumentLimits;
  theme?: Theme;
}

export function buildCatalog(options: BuildCatalogOptions = {}): UiCatalog {
  const registry = options.registry ?? standardNodeRegistry;
  const limits = options.limits ?? DEFAULT_LIMITS;
  const theme = options.theme ?? DEFAULT_THEME;

  const components: CatalogComponent[] = Object.values(registry).map((def) => ({
    type: def.type,
    description: def.description,
    props: Object.fromEntries(
      Object.entries(def.props).map(([name, spec]) => [
        name,
        {
          type: spec.type,
          required: spec.required ?? false,
          ...(spec.minimum !== undefined ? { minimum: spec.minimum } : {}),
          ...(spec.maximum !== undefined ? { maximum: spec.maximum } : {}),
          ...(spec.integer ? { integer: true } : {}),
        },
      ]),
    ),
    childPolicy: def.childPolicy,
    allowedEvents: [...def.allowedEvents],
    example: def.example,
    ...(def.accessibleLabelProp ? { accessibleLabelProp: def.accessibleLabelProp } : {}),
    ...(def.keyboard ? { keyboard: [...def.keyboard] } : {}),
  }));

  return {
    protocolVersion: PROTOCOL_VERSION,
    catalogVersion: CATALOG_VERSION,
    components,
    limits,
    theme,
  };
}

/** The default catalog for the standard node registry. */
export const standardCatalog: UiCatalog = buildCatalog();
