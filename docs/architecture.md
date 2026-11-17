# Architecture and limits

The repository produces three distributions from one interface and one engine:

```text
apps/web/ + packages/wasm/pkg/ ──────────────────────► dist/web/
            + packages/extension/ + apps/chrome/ ────► dist/chrome/
            + packages/extension/ + apps/firefox/ ───► dist/firefox/
```

`scripts/build.mjs` copies an explicit list of runtime assets into each target and preserves their relative URLs. The web distribution includes the Pages marker; extension distributions add their own manifest and shared popup scripts/styles. The assembler derives both extension HTML entry points from the shared web HTML: `popup.html` adds compact styling, while `index.html` keeps the full interface. Small `web-only` and `extension-only` blocks in the shared HTML select the controls for each distribution; the assembler does not construct form markup in JavaScript. Both load `extension-page.js`, which imports the shared app module. Generated output is kept out of the source and documentation directories.

Both browser manifests set `action.default_popup` to `popup.html`; no background context is needed. The popup queries the active tab with `activeTab`, normalizes recognized hosting pages to a repository identity (including the origin for non-GitHub hosts), and calls the shared analysis UI. Each popup/tab owns its worker, Wasm instance, progress, cancellation, and result data. Closing a popup stops unfinished work.

`packages/extension/results.js` stores only the latest completed result in extension-origin local storage, without source contents or extra permissions. Reopening on the same repository within five minutes restores it; a different repository or expired result triggers fresh analysis. `Open details` saves the displayed result again and passes its ID to the full tab, so the tab can restore the same completed result without fetching it again. If analysis is unfinished, a repository URL instead starts it in the new tab. Missing/replaced caches fall back to repository analysis or the input screen. The standalone web app retains its `?repo=` entry point and does not use extension storage.


`apps/web/repositories.js` owns repository input parsing, toolbar URL recognition, and commit links. `hosts.js` owns all hosting-specific enumeration and HTTP/JSON handling: REST trees, directory pagination, Hugging Face asset exclusion, SourceForge’s Allura code table, and sourcehut archives. `archive.js` owns bounded stream reads and Git/gzip/tar parsing. `exclude.js` holds the directory exclusion list. The worker applies one shared selection, download, cancellation, and Wasm analysis pipeline. The web app keeps GitHub and local files; extensions use the multi-host entry point.

`packages/extension/extension-page.js` handles popup/tab startup, per-server permission requests, and opening details; `results.js` stores the latest result. Their UI markup lives in the shared HTML, general styling in `style.css`, and popup sizing in `popup.css`. These remain plain JavaScript, HTML, and CSS without a framework or bundler.

Self-hosted GitLab/Forgejo/Gitea origins require a user-triggered optional permission request. The chosen origin/type is remembered locally. Required permissions remain limited to known service origins. Requests omit credentials; private/authenticated repositories are outside this edition.

At runtime, all three applications use the same analysis flow:

```text
Hosting APIs / Git archives ──┐
                             ├─ Web Worker ─ wasm-bindgen ─ Rust tokei
Local files (web only) ───────┘                                 │
                                                               ▼
                                                UI / JSON / CSV
```

- Rust wrapper: `packages/wasm/src/lib.rs`, using `tokei = "=15.0.0"` with `default-features = false` and upstream `LanguageType::parse_from_slice`.
- JavaScript collects bytes, applies browser limits, aggregates results, and renders the UI; it does not implement a replacement lexer.
- Language colors load once per page from [ozh/github-colors](https://github.com/ozh/github-colors), an automatically updated JSON version of GitHub Linguist's colors. There is no bundled palette or manual color update step. `apps/web/language-colors.js` maps differing tokei names; missing colors or a failed/timed-out request use gray without blocking analysis.
- Browser limits: **1,200 source files**, **1.5 MB per file**, **25 MB total**. Remote file responses also have a streamed per-file download limit. Sourcehut archives have additional compressed/expanded bounds described in the extension guide. Oversized, binary, unreadable, or failed downloads count as omitted; excluded directories and unknown extensions are ignored before selection.
- Dependency/build directories and most hidden directories are excluded by name; `.github` is allowed. This edition does **not** apply `.gitignore`, `.ignore`, or `.tokeignore` syntax.
- Language detection uses file extensions and common special filenames; it does not inspect extensionless shebangs. Repository totals can differ from the native CLI's filesystem traversal.
- Embedded counts are included in the host file's summarized statistics and retained in its JSON `embedded` field. A `.html` file containing JavaScript remains listed under HTML.
- Hosted analysis supports public repositories only. API rate limits, CORS/network errors, and truncated repository trees are reported. Empty repositories and selections without readable source files return errors.
- Dynamic API endpoints and database caches from the original project are outside this static edition.
