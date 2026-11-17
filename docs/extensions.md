# Browser extensions

The Chrome and Firefox extensions analyze public Git repositories. Private repositories and authentication tokens are unsupported. Local files require the web app.

## Build and install

Requires Node 22+. The checked-in Wasm is used; Rust and npm dependencies are not required.

```sh
npm run build:extensions
```

Outputs: `dist/chrome/` and `dist/firefox/`. To create versioned ZIPs in `dist/`, run `npm run package:extensions` with `zip` installed. Extract ZIPs before loading them. Missing engine artifacts require a [Wasm rebuild](development.md#rebuild-wasm).

Chrome:

1. Open `chrome://extensions` and enable Developer mode.
2. Select Load unpacked and choose `dist/chrome/`.
3. Pin tokei / wasm from the Extensions menu.

Firefox 140+:

1. Open `about:debugging#/runtime/this-firefox`.
2. Select Load Temporary Add-on and choose `dist/firefox/manifest.json`.
3. Pin tokei / wasm from the Extensions menu.

Firefox removes temporary add-ons on restart. The ZIP is unsigned; persistent installation in standard Firefox requires Mozilla signing. Store publication and signing are not included.

After rebuilding, reload the extension from the browser's extension management page.

## Use

Visit a supported repository and click the toolbar icon to see its metrics. Analysis covers the entire default branch, including when the active page shows another branch, a file, an issue, or a pull request. Other pages show a short prompt.

Keep the popup open until analysis finishes. Closing it stops unfinished work. Open details opens the full interface in a tab; completed results transfer without another download, while unfinished analysis restarts there.

The popup shows counts and a language chart. Refresh reruns analysis or retries a failure. URL input and server settings are in the details tab, along with file counts, search, sorting, a line-composition chart, and JSON/CSV exports. The interface is in English.

Only the latest completed result is stored locally: counts, filenames, host, revision, and analysis time, without source contents. Reopening the same repository within five minutes restores it. Storage failures prevent restoration but leave analysis usable.

## Supported hosts

| Service | Accepted input / scope |
| --- | --- |
| GitHub | `github.com`, `owner/repository`, Git SSH URLs |
| GitLab | `gitlab.com`, including nested groups and `/-/` subpages |
| Codeberg / Forgejo / Gitea | `codeberg.org`, `code.forgejo.org`, `gitea.com` |
| Gitee | `gitee.com` |
| sourcehut | `git.sr.ht/~user/repository` |
| Bitbucket Cloud | `bitbucket.org/workspace/repository`; Server/Data Center unsupported |
| SourceForge Git | `sourceforge.net/p/project/repository`, `/u/` forks, HTTPS clone URLs |
| Hugging Face | `huggingface.co` / `hf.co`: models, datasets, and Spaces |
| Self-hosted GitLab / Forgejo / Gitea | HTTPS servers at the origin root; custom ports and URL prefixes unsupported |

For a self-hosted server, open its repository and select Open details. The URL is filled in; choose Other Git servers → Server type, then Analyze to grant access to that origin. The origin and server type are remembered for later toolbar use. After revoking access, use Refresh in the popup or Analyze in the details tab to grant it again.

SourceForge supports Git code pages, not project downloads, SVN, or Mercurial. It reads Allura code tables; browser challenges or HTML changes can prevent retrieval. Remote page scripts are not executed.

sourcehut downloads the whole Git archive before selecting source files. Its archive endpoint may return an HTTP 418 browser challenge; analysis then stops.

Hugging Face supports namespaced and legacy single-name model IDs. Git LFS and Xet assets are excluded before content requests, so weights and large dataset assets are not downloaded. Private, gated, and disabled repositories are rejected. Model, dataset, and Space caches are separate.

Host authentication requirements, disabled APIs, rate limits, and browser challenges can prevent analysis. See [analysis limits](architecture.md#analysis-limits) for size and file-count bounds.

## Permissions and data

Both extensions use Manifest V3. `activeTab` reads the active tab URL after a toolbar click. Required host access covers:

```text
api.github.com          raw.githubusercontent.com
gitlab.com             codeberg.org
code.forgejo.org       gitea.com
git.sr.ht              gitee.com
api.bitbucket.org      sourceforge.net
git.code.sf.net        huggingface.co
```

Optional HTTPS permissions allow access to individual self-hosted origins on request. They do not grant access to all HTTPS sites automatically.

JavaScript, Wasm, and workers are packaged locally. The CSP allows HTTPS connections. There is no background script, page injection, analytics, or application server. Host requests omit browser credentials. Language color metadata is fetched separately; source contents are not sent with it.

## Verification

Install the [browser test dependencies](development.md#test), then run:

```sh
npm test
npm run test:extensions
```

Node tests check parsing, provider pagination, revision pinning, archive limits, cancellation, storage failures, manifests, and ZIP contents. Chromium tests load the installed Chrome package and cover providers, Wasm analysis, cache restoration, details transfer, exports, permissions, layout, and CSP. Tests open the popup directly and supply the active tab URL because Playwright cannot operate toolbar controls.

For Firefox, temporarily load the manifest and analyze a small public repository on each service. Check popup completion, result restoration, details transfer, source links, and JSON/CSV downloads. Confirm local file controls are absent and no Wasm/CSP errors occur. Test a self-hosted server with access denied and granted.
