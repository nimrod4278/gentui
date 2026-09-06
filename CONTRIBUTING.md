# Contributing

Thanks for helping improve gentui. The project is experimental, so discuss large API or protocol changes in an issue before investing in an implementation.

## Development setup

Requirements:

- Node.js 20 or newer
- npm 10 or newer
- A POSIX environment for the real pseudo-terminal tests (those tests skip when unsupported)

```sh
git clone <repository-url>
cd gentui
npm ci
npm run typecheck
npm test
```

Useful commands are listed in [TESTING.md](TESTING.md). Before submitting a change, run:

```sh
npm run typecheck
npm test
npm run test:release
npm audit --omit=dev --audit-level=high
```

Changes to validation, authorization boundaries, terminal ownership, or cleanup should also run the relevant fuzz, mutation, and PTY gates.

## Pull requests

- Keep changes focused and include tests for observable behavior.
- Update public types and documentation together.
- Treat generated documents, terminal input, and model output as untrusted.
- Do not add provider SDKs or side-effect capabilities to the core runtime.
- Do not commit generated output, credentials, recordings, prompts containing private data, or user-entered values.
- Add a changeset or changelog entry once the project adopts a release process; none is required before then.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Contributions are licensed under the repository's [MIT License](LICENSE).
