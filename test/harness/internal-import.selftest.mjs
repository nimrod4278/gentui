// FIXTURE — a plain-Node ESM package consumer. Proves that the published
// `gentui` exports map (a) resolves the public entry and (b) refuses an
// unadvertised internal path. Run by the harness meta-test with the workspace
// root as cwd, so `gentui` resolves via node_modules.
//
// Exit codes: 0 = both behaviors correct; non-zero = a violation.

try {
  const pub = await import("gentui");
  if (pub.PROTOCOL_VERSION !== "1") {
    console.error("PUBLIC_IMPORT_WRONG_SHAPE");
    process.exit(4);
  }
  console.log("PUBLIC_IMPORT_OK");
} catch (err) {
  console.error("PUBLIC_IMPORT_FAILED", err && err.code, err && err.message);
  process.exit(5);
}

try {
  await import("gentui/internal/private-registry");
  console.error("INTERNAL_IMPORT_UNEXPECTEDLY_SUCCEEDED");
  process.exit(2);
} catch (err) {
  console.error("INTERNAL_IMPORT_BLOCKED", err && err.code);
  process.exit(err && err.code === "ERR_PACKAGE_PATH_NOT_EXPORTED" ? 1 : 3);
}
