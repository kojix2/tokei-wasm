# Architecture and limits

All three apps share plain JavaScript, HTML, CSS, and one Rust/Wasm engine. There is no framework or bundler.

## Source layout

| Path | Responsibility |
| --- | --- |
| `apps/web/` | Shared interface, worker, charts, and static assets |
| `apps/web/repositories.js` | Repository input, toolbar URL recognition, source links |
| `apps/web/hosts.js` | Host APIs, pagination, archives, and asset exclusion |
| `apps/web/archive.js` | Bounded stream reads and Git/gzip/tar parsing |
| `apps/web/exclude.js` | Directory exclusions |
| `apps/chrome/`, `apps/firefox/` | Browser manifests |
| `packages/extension/` | Popup/tab startup, host permissions, result storage, popup styles |
| `packages/wasm/` | Rust adapter, vendored compatibility patch, compiled `pkg/` |
| `scripts/` | Assembly, packaging, Wasm build, local server |
| `tests/` | Node and browser tests |
| `dist/` | Generated apps and ZIPs; ignored by Git |

`scripts/build.mjs` copies shared assets and Wasm into each distribution. It selects `web-only` / `extension-only` HTML blocks and derives extension `popup.html` and `index.html` from the shared HTML. Extension views load `extension-page.js`; the popup also loads `popup.css`. Each distribution includes licenses and preserves relative runtime URLs.

## Analysis flow

A Web Worker reads bytes from host APIs, Git archives, or local files, applies selection limits, and calls Rust through wasm-bindgen. JavaScript aggregates and displays the results and exports JSON/CSV. It does not implement a lexer.

`packages/wasm/src/lib.rs` uses tokei 15.0.0 with default features disabled and calls upstream `LanguageType::parse_from_slice`. Each popup or tab owns its worker, Wasm instance, progress, cancellation, and results.

The web app accepts GitHub and local inputs; extensions enable the other hosts. Hosted enumeration, downloads, and source links use the same revision. GitHub/Gitee use trees and pinned raw files; GitLab uses paginated trees and immutable blobs; Forgejo/Gitea, Bitbucket, and Hugging Face use paginated APIs. sourcehut uses Git refs and archives; SourceForge uses Git refs and Allura code pages.

`packages/extension/results.js` keeps the latest completed result in extension-origin local storage. Open details passes its result ID to the new tab; missing or replaced results fall back to repository analysis or the input screen. The web app uses `?repo=` links and does not use extension storage. See [extension behavior](extensions.md#use) for cache lifetime and popup handling.

Language colors load once per page from [ozh/github-colors](https://github.com/ozh/github-colors). `language-colors.js` maps differing tokei names. Missing colors and failed or timed-out requests use gray without blocking analysis.

## Analysis limits

MB values below use decimal bytes.

| Resource | Limit |
| --- | --- |
| Selected source files | 1,200 |
| Source file size / streamed download | 1.5 MB |
| Total source contents | 25 MB |
| Tree enumeration | 100,000 entries |
| sourcehut Git refs / compressed archive / expanded archive | 1 MB / 32 MB / 100 MB |
| SourceForge Git refs / code-tree page | 1 MB / 4 MB per directory |

Oversized, binary, unreadable, and failed files count as omitted. Truncated trees and enumeration limits produce warnings about incomplete results. Successful files remain in the results. Empty repositories and selections without readable source files return errors.

Dependency/build directories and most hidden directories are excluded by name; `.github` is allowed. Unknown extensions are ignored before selection. Symlinks and non-regular archive members are excluded where the host exposes their type.

This app does not apply `.gitignore`, `.ignore`, or `.tokeignore` rules. Language detection uses extensions and special filenames, without inspecting extensionless shebangs. Counts can therefore differ from the native CLI's filesystem traversal.

Embedded language counts are included in the host file's totals and retained in JSON's `embedded` field. HTML containing JavaScript remains listed under HTML.

Hosted analysis requires public repositories. API rate limits, CORS/network failures, and host blocking are reported. See [host-specific restrictions](extensions.md#supported-hosts).
