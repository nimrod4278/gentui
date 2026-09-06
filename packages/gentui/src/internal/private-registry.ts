// Intentionally NOT listed in the package `exports` map.
//
// A consumer that tries to `import "gentui/internal/private-registry"` must be
// rejected by Node's exports enforcement with ERR_PACKAGE_PATH_NOT_EXPORTED.
// The harness proves this in test/harness.spec.ts.

export const INTERNAL_MARKER = "internal-only" as const;
