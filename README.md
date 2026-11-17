# tokei / wasm

Count code, comments, and blank lines in public Git repositories or local source files with the original **Rust tokei 15.0.0 parser**, compiled to WebAssembly. This repository contains a web app, a Chrome extension, and a Firefox extension. They share the same analysis engine. The web app supports GitHub and local files; the extensions focus on hosted repositories. No application server, account, or database is needed.

## Applications

| Application | Source | Distribution |
| --- | --- | --- |
| Web app / GitHub Pages | [`apps/web/`](apps/web/) | `dist/web/` |
| Chrome extension | [`apps/chrome/`](apps/chrome/) | `dist/chrome/` |
| Firefox extension | [`apps/firefox/`](apps/firefox/) | `dist/firefox/` |

## Quick start

With Node 22 or later:

```sh
npm start
```

Open **http://127.0.0.1:8000**. The command builds and serves the web app. No `npm install` or Rust installation is required: the shared compiled engine is checked in under `packages/wasm/pkg/`.

To build all three applications or create extension ZIPs:

```sh
npm run build
npm run package:extensions
```

Load `dist/chrome/` through Chrome's **Load unpacked**, or select `dist/firefox/manifest.json` through Firefox's **Load Temporary Add-on**. The toolbar button opens a compact popup with line counts and language charts for the current repository's entire default branch. **Open details** opens the full interface in a tab. See the [extension guide](docs/extensions.md) for installation, permissions, and signing limitations.

## Features

- Analyze public GitHub repository root URLs, `owner/repository`, or GitHub SSH-style URLs. A `?repo=owner/repository` link starts analysis automatically.
- In the web app, analyze local folders, individual files, or dropped folders/files without uploading source contents.
- In the extensions, analyze GitHub, GitLab (including nested groups), Codeberg, Forgejo/Gitea, sourcehut, Gitee, Bitbucket Cloud, SourceForge Git, and Hugging Face (models, datasets, and Spaces). Hugging Face LFS/Xet assets are excluded without downloading weights or large datasets. Add self-hosted GitLab/Forgejo/Gitea servers by granting access to that server.
- Count code, comments, and blank lines with upstream tokei, including nested comments, strings, and embedded languages.
- View language bar charts and table markers in GitHub's language colors, plus a code/comment/blank-line donut chart. Expand file-level counts, search filenames/languages, and sort the table.
- Cancel immediately and start another analysis. Failed/binary files and browser limits are reported without discarding successful results.
- Download JSON including results, warnings, omitted-file counts, engine version, analysis time, and repository revision, or download per-file CSV.
- Use the interface on desktop and mobile, with keyboard tabs, expandable rows, and status announcements.

Hosted analysis pins downloads and source links to the same commit, so a moving branch does not mix revisions. Local analysis and charts run entirely in the browser. The page fetches public language color metadata once; source contents are never sent with that request.

## Repository layout

```text
apps/
  web/              Shared web interface, worker, and static assets
  chrome/           Chrome Manifest V3 configuration
  firefox/          Firefox Manifest V3 configuration
packages/
  extension/        Shared popup, host permissions, and result cache
  wasm/             Rust crate, vendored compatibility patch, and compiled pkg/
scripts/            Shared assembly, packaging, engine build, and local server
tests/              Node tests and web/extension browser tests
docs/               Development, architecture, and installation guides
dist/               Generated web, Chrome, Firefox, and ZIP distributions
```

Web assets and host adapters have one source in `apps/web/`. The assembler creates the extension views from the shared HTML and removes the web-only local file controls. Browser manifests live with their applications; only the two extensions include `packages/extension/`. All apps load the same compiled engine. `dist/` is generated and ignored by Git; `docs/` contains documentation.

## Development

```sh
npm test
npm ci
npx playwright install chromium
npm run test:browser
npm run test:extensions
```

Node tests include real Wasm/worker integration and extension ZIP validation; packaging checks require `zip` and `unzip`. Rust changes can be rebuilt and checked with `npm run build:wasm`. Pull requests run CI; successful `main` builds publish the web app to GitHub Pages and provide extension ZIPs as a workflow artifact.

- [Development and GitHub Pages](docs/development.md)
- [Browser extension installation and permissions](docs/extensions.md)
- [Architecture, behavior, and limits](docs/architecture.md)
- [Contributing](CONTRIBUTING.md)

## License

[MIT](LICENSE). Distributed applications also include the upstream tokei and vendored home licenses.
