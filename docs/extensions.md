# Browser extensions

The extensions bundle the same application and Rust/Wasm engine. Click **Analyze with tokei** in the browser toolbar while viewing a public GitHub repository to open its analysis in a new tab. Repository file, branch, issue, and pull request pages are recognized; analysis always covers the **entire default branch**, regardless of the branch or file being viewed. On other pages, the button opens the input screen. Each click opens a new tab so an existing analysis can keep running.

Local files/folders, charts, filtering, cancellation, and JSON/CSV downloads work in the extension too. The interface remains in English. Local analysis works offline; language colors use gray if the optional palette request fails. No source files are uploaded, and private repositories and authentication tokens are not supported.

### Build and package

With Node 22+, run:

```sh
npm run build:extensions
```

This creates **`dist/chrome/`** and **`dist/firefox/`**, each containing a ready-to-load `manifest.json`, application assets, Wasm, and licenses. The checked-in Wasm is reused; Rust and `npm install` are not needed. If the engine artifacts are missing or need updating, run `npm run build:wasm` first with the Rust prerequisites below.

To also create **`dist/tokei-wasm-chrome-0.1.0.zip`** and **`dist/tokei-wasm-firefox-0.1.0.zip`**:

```sh
npm run package:extensions
```

Packaging requires the `zip` command (included on macOS and commonly available on Linux). Generated folders and archives are ignored by Git. A rebuild replaces the generated browser folders, so edit the shared interface in `apps/web/`, launch code in `packages/extension/`, and browser manifests in `apps/chrome/` or `apps/firefox/`, rather than files in `dist/`.

### Install in Chrome

1. Open **`chrome://extensions`** and enable **Developer mode**.
2. Click **Load unpacked**, then select **`dist/chrome/`**. If using the ZIP, extract it first and select the extracted folder containing `manifest.json`.
3. Pin **tokei / wasm** using the toolbar's Extensions menu, visit a public GitHub repository, and click the icon.

### Install in Firefox

Firefox 140+ is supported.

1. Open **`about:debugging#/runtime/this-firefox`**.
2. Click **Load Temporary Add-on**, then select **`dist/firefox/manifest.json`**. If using the ZIP, extract it first and select its `manifest.json`.
3. Pin **tokei / wasm** from the Extensions menu and click it on a public GitHub repository.

Temporary add-ons are removed when Firefox restarts. The ZIP is unsigned; persistent installation in standard Firefox requires Mozilla signing. Store submission, publication, and signing are not part of this distribution.

### Permissions and verification

Both extensions use Manifest V3. `activeTab` reads the clicked tab's URL after the toolbar action; access to `api.github.com` and `raw.githubusercontent.com` supports public repository downloads and language colors. No page content is injected or changed. All executable JavaScript and Wasm are packaged locally. GitHub receives ordinary API/file requests for the selected repository; no analytics or application server is used.

After installing browser test dependencies as described below:

```sh
npm test
npm run test:extensions
```

The extension tests build the packages and load the Chrome version in a temporary Chromium profile, testing GitHub/default-branch analysis, offline local analysis, both exports, and the extension's CSP. Set `CHROME_PATH` to use an existing Chrome for Testing or Chromium installation that supports loading unpacked extensions. The toolbar handler is invoked inside the installed extension because browser toolbar controls are outside Playwright's page automation surface. Node tests also cover both manifests, URL recognition, actual toolbar listener registration, valid Wasm, missing-build errors, and ZIP contents. They require `zip` and `unzip`.

For a Firefox smoke check, temporarily load its manifest, click the toolbar button on both a repository and a non-GitHub page, and analyze a local Rust file containing `fn main() {}`. Confirm one line of code, working JSON/CSV downloads, and no Wasm/CSP errors in the extension debugger.
