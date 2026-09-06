# `gentui-testing`

Deterministic test helpers for gentui hosts and renderers, including an in-memory renderer, fake clock, seeded random generator, terminal profiles, timer leak detection, and POSIX pseudo-terminal fixtures.

```sh
npm install --save-dev gentui gentui-testing
```

```ts
import { createInMemoryRenderer, STANDARD_PROFILE } from "gentui-testing";
import { createRuntime } from "gentui";

const renderer = createInMemoryRenderer();
const runtime = createRuntime({ renderer, profile: STANDARD_PROFILE });
```

This package is intended for development and tests. See the repository [testing guide](https://github.com/nimrod4278/gentui/blob/main/TESTING.md).

## License

MIT
