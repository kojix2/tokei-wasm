# Browser extensions

The Chrome and Firefox extensions analyze **public hosted Git repositories**. Click **Analyze with tokei** in the browser toolbar to open a compact popup with line counts, file/language totals, and a language bar chart. Analysis covers the **entire default branch**, even when viewing a file, another branch, an issue, or a pull request. On other pages, enter a repository URL.

| Service | Recognized host / input | Download method |
| --- | --- | --- |
| GitHub | `github.com`, `owner/repository`, Git SSH URLs | REST tree + commit-pinned raw files |
| GitLab | `gitlab.com`, nested groups, `/-/` subpages | Paginated tree + immutable blobs |
| Codeberg / Forgejo | `codeberg.org`, `code.forgejo.org` | Paginated Forgejo API + pinned raw files |
| Gitea | `gitea.com` | Same compatible API as Forgejo |
| Gitee | `gitee.com` | REST tree + public commit-pinned raw URLs |
| sourcehut | `git.sr.ht/~user/repository` | Public Git refs + commit archive |
| Bitbucket Cloud | `bitbucket.org/workspace/repository` | Paginated directory traversal + pinned raw files |
| SourceForge Git | `sourceforge.net/p/project/repository` (or `/u/` forks), HTTPS clone URLs | Git HEAD + commit-pinned Allura code-tree pages/raw files |
| Hugging Face | `huggingface.co` / `hf.co`: models, `/datasets/`, `/spaces/` | Commit-pinned Hub tree API + Git raw files |
| Self-hosted GitLab / Forgejo / Gitea | HTTPS server at the origin root | Choose **Other Git servers → Server type** and enter its repository URL |

Self-hosted servers request access to **only the origin entered** when you click **Analyze**. After permission is granted, the server type is remembered so later toolbar clicks recognize its repositories. Revoked permissions require clicking Analyze again. Custom ports and installations under a URL prefix are not supported. API-disabled instances, authentication requirements, rate limits, and host-side blocking can prevent retrieval; the extension does not bypass them.

**Open details** opens a full tab with file-level counts, filtering, sorting, a line-composition chart, and JSON/CSV exports. Completed results transfer without downloading again. The latest completed result (counts, filenames, host, revision, and analysis time, without source contents) is saved on the device. Reopening the popup on the same repository within five minutes restores it; **Analyze** refreshes it. Only the latest result is retained. Storage failures leave analysis usable but prevent restoration.

Keep the popup open until analysis completes: closing it stops unfinished work. For a large repository, use **Open details** to restart analysis in a tab that can remain open. The interface remains in English. Private repositories and authentication tokens are not supported. **Local files and folders are available only in the web app**, not in either extension view.

Bitbucket support covers **Cloud Git repositories**, not Bitbucket Server/Data Center installations. SourceForge support covers **Git code pages** such as `https://sourceforge.net/p/maxima/code/`; project download pages, SVN, and Mercurial repositories are not supported. Its file list is read from Allura’s code table, so browser challenges or changes to the host’s HTML can prevent retrieval. Remote page scripts are never executed.

Hugging Face supports namespaced and legacy single-name model IDs, dataset repositories, and Spaces. Files stored using **Git LFS or Xet are excluded before any content request**, with an explanatory result warning; model weights and large dataset assets are not downloaded. Ordinary source, configuration, and documentation files still use the shared language/size limits. Private, gated, and disabled repositories are rejected. Cache identities include the repository type, so a model, dataset, and Space with the same name do not share results.

### Limits and service APIs

All hosts share limits of **1,200 source files**, **1.5 MB/file**, and **25 MB of source contents**. Tree enumeration stops at 100,000 entries and reports incomplete results. GitHub/Gitee tree truncation and file download failures are also reported. For sourcehut, the whole Git archive must be downloaded before selection; it has additional limits of **1 MB of Git refs**, **32 MB compressed**, and **100 MB expanded**. SourceForge code-tree pages are limited to **4 MB per directory**, and its Git refs to **1 MB**. Symlinks and non-regular archive members are excluded where the host exposes their type. The advertised commit, archive commit, downloads, and source links are checked/pinned to the same revision.

GitLab uses its [public repositories API](https://docs.gitlab.com/api/repositories/). Forgejo uses its [repository API and pagination](https://forgejo.org/docs/latest/user/api/usage/). Gitee's authenticated raw API is avoided in favor of public raw URLs. sourcehut's GraphQL endpoint requires authentication, so public Git refs and archives are used instead. Its archive endpoint may return an anti-bot browser challenge (HTTP 418), including in Firefox; in that case analysis stops with an explanation. No challenge bypass is attempted.

Bitbucket follows its [source API](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-source/) directory pagination. Hugging Face follows the [Hub repository tree API](https://huggingface.co/docs/huggingface_hub/package_reference/hf_api#huggingface_hub.HfApi.list_repo_tree), including continuation links on the same immutable listing endpoint. SourceForge uses public Git refs and the [Allura code browser](https://github.com/apache/allura/blob/master/Allura/allura/controllers/repository.py).

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

Packaging requires the `zip` command (included on macOS and commonly available on Linux). Generated folders and archives are ignored by Git. A rebuild replaces the generated browser folders, so edit the shared interface in `apps/web/`, popup behavior and styles in `packages/extension/`, and browser manifests in `apps/chrome/` or `apps/firefox/`, rather than files in `dist/`. After rebuilding, reload the installed extension in the browser's extension management page.

### Install in Chrome

1. Open **`chrome://extensions`** and enable **Developer mode**.
2. Click **Load unpacked**, then select **`dist/chrome/`**. If using the ZIP, extract it first and select the extracted folder containing `manifest.json`.
3. Pin **tokei / wasm** using the toolbar's Extensions menu, visit a supported public repository, and click the icon.

### Install in Firefox

Firefox 140+ is supported.

1. Open **`about:debugging#/runtime/this-firefox`**.
2. Click **Load Temporary Add-on**, then select **`dist/firefox/manifest.json`**. If using the ZIP, extract it first and select its `manifest.json`.
3. Pin **tokei / wasm** from the Extensions menu and click it on a supported public repository.

Temporary add-ons are removed when Firefox restarts. The ZIP is unsigned; persistent installation in standard Firefox requires Mozilla signing. Store submission, publication, and signing are not part of this distribution.

### Permissions and verification

Both extensions use Manifest V3 with `action.default_popup`. `activeTab` reads the active tab URL after a toolbar click. Required host access covers `api.github.com`, `raw.githubusercontent.com`, `gitlab.com`, `codeberg.org`, `code.forgejo.org`, `gitea.com`, `git.sr.ht`, `gitee.com`, `api.bitbucket.org`, `sourceforge.net`, `git.code.sf.net`, and `huggingface.co`. Optional HTTPS host permissions allow adding an individual self-hosted server on demand; access to every HTTPS site is not requested automatically. The CSP permits HTTPS connections while executable JavaScript, Wasm, and workers remain packaged locally. No background script or page injection is used. Hosts receive ordinary API/file requests; there is no analytics or application server, and requests omit browser credentials.

After installing browser test dependencies as described below:

```sh
npm test
npm run test:extensions
```

The extension tests load the Chrome package in a temporary Chromium profile. They cover all hosted providers, the actual Rust/Wasm engine, cache isolation/restoration, transfer to detail tabs, exports, self-hosted permission denial/approval, removal of local file controls, cold popup width, scrolling, and CSP. Browser toolbar controls are outside Playwright's automation surface, so tests load the installed popup and supply the active tab URL normally granted by a toolbar click. Network fixtures keep these tests independent of live hosts. Set `CHROME_PATH` to use an existing Chrome for Testing or Chromium installation.

Node tests cover URL parsing, provider pagination, revision pinning, source links, archive corruption/limits, cancellation, storage failures, both manifests, and ZIP contents. Packaging checks require `zip` and `unzip`.

For a Firefox smoke check, temporarily load its manifest and test a small public repository on each service. Confirm analysis stays inside the popup, no local file controls appear, reopening restores results, and **Open details** transfers the results and links to the correct host. Verify JSON/CSV downloads and the absence of Wasm/CSP errors. Check a self-hosted server with both denied and granted access.
