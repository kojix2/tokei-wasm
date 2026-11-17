# Architecture and limits

The repository produces three distributions from one interface and one engine:

```text
apps/web/ + packages/wasm/pkg/ ──────────────────────► dist/web/
            + packages/extension/ + apps/chrome/ ────► dist/chrome/
            + packages/extension/ + apps/firefox/ ───► dist/firefox/
```

`scripts/build.mjs` copies an explicit list of runtime assets into each target and preserves their relative URLs. The web distribution includes the Pages marker; extension distributions add their own manifest and shared launch scripts. Generated output is kept out of the source and documentation directories.

The browser background context only opens analysis tabs. Each tab owns its worker, Wasm instance, progress, cancellation, and result data. Chrome uses a module service worker; Firefox uses a module background script. Both call the same toolbar handler, which normalizes recognized GitHub repository pages to `owner/repository` and passes it through the existing `?repo=` entry point. Other pages open the input screen.

At runtime, all three applications use the same analysis flow:

```text
GitHub REST API / raw files ─┐
                            ├─ Browser Web Worker ─ wasm-bindgen ─ Rust tokei
Local File objects ─────────┘                                      │
                                                                  ▼
                                               UI / charts / JSON / CSV
```

- Rust wrapper: `packages/wasm/src/lib.rs`, using `tokei = "=15.0.0"` with `default-features = false` and upstream `LanguageType::parse_from_slice`.
- JavaScript collects bytes, applies browser limits, aggregates results, and renders the UI; it does not implement a replacement lexer.
- Language colors load once per page from [ozh/github-colors](https://github.com/ozh/github-colors), an automatically updated JSON version of GitHub Linguist's colors. There is no bundled palette or manual color update step. `apps/web/language-colors.js` maps differing tokei names; missing colors or a failed/timed-out request use gray without blocking analysis.
- Browser limits: **1,200 source files**, **1.5 MB per file**, **25 MB total**. GitHub responses also have a streamed per-file download limit. Oversized, binary, unreadable, or failed downloads count as omitted; excluded directories and unknown extensions are ignored before selection.
- Dependency/build directories and most hidden directories are excluded by name; `.github` is allowed. This edition does **not** apply `.gitignore`, `.ignore`, or `.tokeignore` syntax.
- Language detection uses file extensions and common special filenames; it does not inspect extensionless shebangs. Repository totals can differ from the native CLI's filesystem traversal.
- Embedded counts are included in the host file's summarized statistics and retained in its JSON `embedded` field. A `.html` file containing JavaScript remains listed under HTML.
- GitHub supports public repositories only. API rate limits, CORS/network errors, and truncated repository trees are reported. Empty repositories and selections without readable source files return errors.
- Dynamic API endpoints and database caches from the original project are outside this static edition.
