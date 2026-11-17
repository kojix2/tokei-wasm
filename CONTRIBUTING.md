# Contributing

Use the [development guide](docs/development.md) for prerequisites and commands, and the [source layout](docs/architecture.md#source-layout) to locate changes.

Keep the upstream tokei parser unchanged. When changing the Rust adapter, rebuild and commit `packages/wasm/pkg/`. Edit source files rather than generated files in `dist/`.

Before opening a pull request, run:

```sh
npm test
npm run test:browser
npm run test:extensions
```

For Rust changes, also run `npm run build:wasm`. For packaging or manifest changes, run `npm run package:extensions` and inspect both ZIPs.

Describe the changed behavior, reason, and checks performed. Include relevant documentation changes. Keep `dist/`, build caches, and test reports out of commits.
