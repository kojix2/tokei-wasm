# tokei / wasm

Analyze a public GitHub repository or a local source folder in your browser using the **original Rust `tokei` 15.0.0 parser**, compiled to WebAssembly. No application server, sign-in, or database is needed.

The built JavaScript and WebAssembly engine are included in `docs/pkg/`. This checkout can run immediately; Rust is only needed when rebuilding the engine.

## Run locally

With Node 22 or later:

```sh
npm start
```

Open **http://127.0.0.1:8000**. No `npm install` is needed to run the app. To use a different port, run `npm start -- --port 8080`.

Alternatively, serve the same static files with Python:

```sh
python3 -m http.server 8000 -d docs
```

Use an HTTP server; opening `index.html` via `file://` cannot load browser module workers.

## Features

- Analyze public GitHub repository root URLs, `owner/repository`, or GitHub SSH-style URLs. A `?repo=owner/repository` link starts analysis automatically.
- Analyze local folders, individual files, or dropped folders/files without uploading source contents.
- Count code, comments, and blank lines with upstream tokei, including nested comments, strings, and embedded languages.
- View language bar charts and table markers in GitHub's language colors, plus a code/comment/blank-line donut chart. Expand file-level counts, search filenames/languages, and sort the table.
- Cancel immediately and start another analysis. Failed/binary files and browser limits are reported without discarding successful results.
- Download JSON including results, warnings, omitted-file counts, engine version, analysis time, and GitHub revision, or download per-file CSV.
- Use the interface on desktop and mobile, with keyboard tabs, expandable rows, and status announcements.

GitHub analysis pins downloads and source links to the same commit, so a moving branch does not mix revisions. Local analysis and charts run entirely in the browser. The page fetches public language color metadata once; source contents are never sent with that request.

## Deploy to GitHub Pages

1. Put these files at the root of a GitHub repository and push to `main`.
2. In **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**.
3. The workflow in `.github/workflows/pages.yml` builds the Rust engine, runs native Rust tests, real Wasm/worker tests, and desktop/mobile Chromium tests, then uploads `docs/` and deploys it.
4. Open `https://YOURNAME.github.io/YOUR_REPO/` after the workflow succeeds.

Everything needed at runtime is in `docs/`, which can also be hosted by another static HTTP server. Relative asset URLs support project subdirectories.

## Rebuild the engine

Prerequisites: stable Rust/Cargo, the `wasm32-unknown-unknown` target, wasm-pack 0.13.1, and Node 22+.

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --version 0.13.1 --locked
npm run build
```

`build-wasm.sh` builds with `wasm/Cargo.lock`, regenerates `docs/pkg/`, and runs the native Rust and JavaScript/Wasm tests. Generated engine files should be kept with the distribution. Do not edit them manually. The build disables the optional wasm-opt download; the engine is compiled with Rust's release size optimization and LTO.

Upstream tokei's `etcetera` dependency pulls in `home` 0.5.12, which does not compile for `wasm32-unknown-unknown`. `wasm/vendor/home/` contains the upstream crate with one compatibility change: `home_dir_inner()` returns `None` on non-Unix/non-Windows targets. Native behavior and **the upstream tokei parser remain unchanged**. The vendored crate includes its original MIT and Apache licenses.

## Verify

```sh
cargo test --manifest-path wasm/Cargo.toml --lib --locked
npm test
```

The JavaScript tests load the actual generated Wasm. They fail if the artifacts are missing, so missing builds cannot silently pass verification. Worker integration tests simulate GitHub responses and file-read failures while using the real Rust parser.

To run the browser tests:

```sh
npm ci
npx playwright install chromium
npm run test:browser
```

Tests cover local folders/files, dropped files, summaries/charts, search/sorting, downloads, GitHub deep links/revision links, cancellation, errors, and retrying. Both desktop and mobile viewports run in Chromium. To use an existing Chrome installation, set `CHROME_PATH=/path/to/chrome`.

## Design and limits

```text
GitHub REST API / raw files ─┐
                            ├─ Browser Web Worker ─ wasm-bindgen ─ Rust tokei
Local File objects ─────────┘                                      │
                                                                  ▼
                                               UI / charts / JSON / CSV
```

- Rust wrapper: `wasm/src/lib.rs`, using `tokei = "=15.0.0"` with `default-features = false` and upstream `LanguageType::parse_from_slice`.
- JavaScript collects bytes, applies browser limits, aggregates results, and renders the UI; it does not implement a replacement lexer.
- Language colors load once per page from [ozh/github-colors](https://github.com/ozh/github-colors), an automatically updated JSON version of GitHub Linguist's colors. There is no bundled palette or manual color update step. `docs/language-colors.js` maps differing tokei names; missing colors or a failed/timed-out request use gray without blocking analysis.
- Browser limits: **1,200 source files**, **1.5 MB per file**, **25 MB total**. GitHub responses also have a streamed per-file download limit. Oversized, binary, unreadable, or failed downloads count as omitted; excluded directories and unknown extensions are ignored before selection.
- Dependency/build directories and most hidden directories are excluded by name; `.github` is allowed. This edition does **not** apply `.gitignore`, `.ignore`, or `.tokeignore` syntax.
- Language detection uses file extensions and common special filenames; it does not inspect extensionless shebangs. Repository totals can differ from the native CLI's filesystem traversal.
- Embedded counts are included in the host file's summarized statistics and retained in its JSON `embedded` field. A `.html` file containing JavaScript remains listed under HTML.
- GitHub supports public repositories only. API rate limits, CORS/network errors, and truncated repository trees are reported. Empty repositories and selections without readable source files return errors.
- Dynamic API endpoints and database caches from the original project are outside this static edition.

## Licensing

MIT-licensed. 
