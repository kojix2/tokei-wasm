# Development

Run commands from the repository root. Node 22+ can assemble the apps using the checked-in Wasm. Rust is needed only to rebuild the engine; npm dependencies are needed for browser tests.

## Commands

| Command | Purpose |
| --- | --- |
| `npm start` | Build and serve the web app at http://127.0.0.1:8000 |
| `npm run build` | Assemble all apps |
| `npm run build:web` | Assemble `dist/web/` |
| `npm run build:extensions` | Assemble `dist/chrome/` and `dist/firefox/` |
| `npm run package:extensions` | Assemble extensions and create versioned ZIPs in `dist/` |
| `npm run build:wasm` | Rebuild Wasm, run Rust tests, assemble apps, and run Node tests |
| `npm test` | Assemble apps and run Node/Wasm/worker/package tests |
| `npm run test:browser` | Build and test the web app in desktop/mobile Chromium |
| `npm run test:extensions` | Build and test the installed Chrome extension in Chromium |

Builds replace the selected output folders. Packaging requires `zip`; package tests also require `unzip`.

Set the server port with `npm start -- --port 8080`. To use another server, run `npm run build:web`, then `python3 -m http.server 8000 -d dist/web`. Module workers require HTTP.

## Rebuild Wasm

Requires stable Rust/Cargo, Node 22+, and wasm-pack 0.13.1:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --version 0.13.1 --locked
npm run build:wasm
```

The build uses `packages/wasm/Cargo.lock`, regenerates `packages/wasm/pkg/`, and runs Rust and Node tests. It uses release size optimization and LTO, with the optional wasm-opt download disabled.

`packages/wasm/vendor/home/` patches home 0.5.12, pulled in by tokei's etcetera dependency, to compile for Wasm: `home_dir_inner()` returns `None` on non-Unix/non-Windows targets. Native behavior and the tokei parser are unchanged. The crate retains its MIT and Apache licenses.

## Test

```sh
cargo test --manifest-path packages/wasm/Cargo.toml --lib --locked
npm test
```

Node tests use the real Wasm, including worker integration with simulated host responses. Missing engine artifacts fail the tests.

For browser tests:

```sh
npm ci
npx playwright install chromium
npm run test:browser
npm run test:extensions
```

Tests cover local input, hosted analysis, charts, filtering, exports, cancellation, errors, and extension behavior. Network fixtures avoid live-host dependencies. Set `CHROME_PATH` to use an existing compatible Chromium installation, or `PLAYWRIGHT_PORT` to change the web test server's default port of 8765. Firefox requires a [manual smoke check](extensions.md#verification).

## CI and GitHub Pages

`.github/workflows/ci.yml` runs on pull requests, pushes to `main`, and manual dispatches. It rebuilds Wasm, runs Rust, Node, and Chromium tests, and uploads extension ZIPs as the `browser-extensions` artifact.

Successful `main` builds deploy `dist/web/` to GitHub Pages. In repository Settings → Pages → Build and deployment → Source, select GitHub Actions. The project site uses `https://YOURNAME.github.io/YOUR_REPO/`; runtime URLs support this subdirectory. Pull requests do not deploy.

## Generated files and versions

Commit rebuilt `packages/wasm/pkg/` so a fresh checkout remains runnable. Do not edit generated engine files by hand or commit `dist/`, build caches, or test reports.

Keep the version in `package.json` and both extension manifests in sync. The assembler rejects mismatches and uses that version in ZIP names. Rust crate and engine metadata have separate versioning.
