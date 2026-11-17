# Development

Run all commands from the repository root. Node 22+ can assemble all three apps from the checked-in Wasm without installing npm packages or Rust. Browser tests require the npm development dependencies.

## Commands

| Command | Purpose |
| --- | --- |
| `npm start` | Build and serve the web app at http://127.0.0.1:8000 |
| `npm run build` | Assemble web, Chrome, and Firefox distributions |
| `npm run build:web` | Assemble only `dist/web/` |
| `npm run build:extensions` | Assemble `dist/chrome/` and `dist/firefox/` |
| `npm run package:extensions` | Assemble extensions and create versioned ZIPs |
| `npm run build:wasm` | Compile Rust/Wasm, run native tests, assemble apps, and run Node tests |
| `npm test` | Assemble all apps and run Node/Wasm/worker/package tests |
| `npm run test:browser` | Build and test the web app on desktop/mobile Chromium |
| `npm run test:extensions` | Build and test the Chrome extension in Chromium |

The generic `npm run build` assembles distributions; rebuilding Rust explicitly uses `build:wasm`. `scripts/build.mjs` is the shared assembly and ZIP entry point. Output folders are replaced on each build for the selected targets; other targets are preserved.

Set another server port with `npm start -- --port 8080`. For a different HTTP server, first run `npm run build:web`, then `python3 -m http.server 8000 -d dist/web`. Module workers require HTTP rather than opening the HTML file directly.

## Rebuild the shared engine

Prerequisites: stable Rust/Cargo, the `wasm32-unknown-unknown` target, wasm-pack 0.13.1, and Node 22+.

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --version 0.13.1 --locked
npm run build:wasm
```

`scripts/build-wasm.sh` builds with `packages/wasm/Cargo.lock`, regenerates `packages/wasm/pkg/`, and runs the native Rust and JavaScript/Wasm tests. Generated engine files should be kept with the distribution. Do not edit them manually. The build disables the optional wasm-opt download; the engine is compiled with Rust's release size optimization and LTO.

Upstream tokei's `etcetera` dependency pulls in `home` 0.5.12, which does not compile for `wasm32-unknown-unknown`. `packages/wasm/vendor/home/` contains the upstream crate with one compatibility change: `home_dir_inner()` returns `None` on non-Unix/non-Windows targets. Native behavior and **the upstream tokei parser remain unchanged**. The vendored crate includes its original MIT and Apache licenses.

## Verify

```sh
cargo test --manifest-path packages/wasm/Cargo.toml --lib --locked
npm test
```

The JavaScript tests load the actual generated Wasm. They fail if the artifacts are missing, so missing builds cannot silently pass verification. Worker integration tests simulate GitHub responses and file-read failures while using the real Rust parser.

To run the browser tests:

```sh
npm ci
npx playwright install chromium
npm run test:browser
npm run test:extensions
```

Tests cover local folders/files, dropped files, summaries/charts, search/sorting, downloads, GitHub deep links/revision links, cancellation, errors, and retrying. Both desktop and mobile viewports run in Chromium. To use an existing Chrome installation, set `CHROME_PATH=/path/to/chrome`.

Web browser tests use port 8765 by default. If another process is using it, set `PLAYWRIGHT_PORT` to an available port.

## GitHub Actions and Pages

`.github/workflows/ci.yml` runs on pull requests, pushes to `main`, and manual dispatches. It rebuilds the engine, runs Rust and Node tests, tests the web app and installed Chromium extension, and packages both browser extensions. The `browser-extensions` workflow artifact contains the ZIPs.

On `main`, the successful build uploads `dist/web/` as a Pages artifact. A separate deployment job depends on that build and receives Pages write permissions; pull requests run verification without deploying. In repository **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**. The site is published at `https://YOURNAME.github.io/YOUR_REPO/`. Relative runtime URLs support project subdirectories.

## Versions and generated files

Keep the extension version in the root `package.json` and both `apps/*/manifest.json` files in sync. The assembler rejects mismatches, and ZIP names use that version. The Rust crate and generated engine metadata describe the engine package separately.

Commit changes to source and, when rebuilding Rust, `packages/wasm/pkg/` so a fresh checkout remains runnable. Do not edit generated engine files by hand. Keep `dist/`, build caches, and test reports out of Git.
