# Contributing

Run commands from the repository root. Start with the [development guide](docs/development.md) for prerequisites and build commands.

## Where to make changes

- Update the shared interface, worker, charts, and static assets in `apps/web/`. These files are distributed with all three apps. Use the existing `web-only` / `extension-only` HTML blocks for view-specific controls.
- Update browser-specific manifests in `apps/chrome/` and `apps/firefox/`.
- Update popup startup/permissions and result restoration in `packages/extension/`. Shared URL parsing belongs in `apps/web/repositories.js`, provider retrieval in `hosts.js`, and stream/archive reading in `archive.js`.
- Update the Rust adapter in `packages/wasm/`; keep the upstream tokei parser unchanged. Rebuild and include `packages/wasm/pkg/` when changing the engine.
- Update assembly and packaging in `scripts/`, and developer-facing documentation in `docs/`.

## Before opening a pull request

Run `npm test`, `npm run test:browser`, and `npm run test:extensions`. For Rust changes, also run `npm run build:wasm`. Browser testing prerequisites are documented in the development guide. Use `npm run package:extensions` to review both distributable ZIPs when changing packaging or manifests.

Explain the behavior changed, the reason for it, and the checks performed. Keep `dist/`, test reports, and build caches out of commits. Include source changes and applicable documentation together.

CI verifies all three distributions for pull requests. GitHub Pages deployment runs only after a successful build on `main`.
