// Deterministic host-managed evaluator fixture for the live bridge contract.
let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
const runs = request.scenarios.flatMap((scenario) =>
  Array.from({ length: request.samplesPerScenario }, () => ({
    scenarioId: scenario.id,
    submittedDocument: !["short-text", "unsupported"].includes(scenario.id),
    submittedUpdate: false,
    schemaValidFirstTry: true,
    reachedIntendedResult: true,
    updateFailed: false,
    retriedGentui: false,
    createdFiles: false,
    emittedAnsi: false,
    exposedSecret: false,
    executableIntent: false,
    finalText: "Completed safely.",
  })),
);
process.stdout.write(JSON.stringify({ provider: "fixture", model: "deterministic", tokenCount: 100, runs }));
