import {test, expect, chromium} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {compressedArchive, refs, revision} from '../helpers/archive.mjs';
import {sourceforgeHTML} from '../helpers/sourceforge.mjs';

const extensionPath = fileURLToPath(new URL('../../dist/chrome', import.meta.url));
const colorURL = 'https://raw.githubusercontent.com/ozh/github-colors/master/colors.json';
let context, origin;

test.beforeEach(async () => {
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true, acceptDownloads: true,
    ignoreDefaultArgs: ['--hide-scrollbars'],
    ...(process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {}),
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  await context.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', event => window.cspViolations.push(event.violatedDirective));
  });
  // Chromium derives the unpacked extension ID from its absolute path.
  const id = createHash('sha256').update(extensionPath).digest('hex').slice(0, 32)
    .replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
  origin = `chrome-extension://${id}`;
  await context.route(colorURL, route => route.fulfill({json: {Rust: {color: '#dea584'}}}));
});
test.afterEach(async () => {await context?.close();});

// Native toolbar controls are outside Playwright's page automation surface.
// Load the installed popup and supply only the tab URL normally granted by a
// user's toolbar click (activeTab). All analysis, storage and tab creation use
// the production extension APIs and bundled engine.
async function toolbarClick(url) {
  const page = await context.newPage();
  await page.setViewportSize({width: 480, height: 600});
  await page.addInitScript(url => {
    chrome.tabs.query = async () => [{url}];
  }, url);
  await page.goto(`${origin}/popup.html`);
  return page;
}
async function downloadText(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

test('popup analyzes the active repository and reuses results on reopen and in the detail tab', async () => {
  const errors = [];
  context.on('weberror', error => errors.push(error.error().message));
  const requests = [];
  await context.route('https://api.github.com/**', route => {
    const url = route.request().url(); requests.push(url);
    const base = 'https://api.github.com/repos/acme/demo';
    const json = url === base ? {default_branch: 'main'} : url === `${base}/commits/main` ?
      {sha: 'commit123', commit: {tree: {sha: 'tree123'}}} :
      {tree: [{path: 'src/main.rs', type: 'blob', mode: '100644', size: 30}]};
    return route.fulfill({json});
  });
  await context.route('https://raw.githubusercontent.com/acme/demo/**', route => route.fulfill({body: 'fn main() {}\n// hi\n\n'}));
  const page = await toolbarClick('https://github.com/acme/demo/blob/feature/other.rs');
  await expect(page).toHaveURL(`${origin}/popup.html`);
  await expect(page.locator('#results')).toBeVisible();
  await expect(page.locator('#stat-code')).toHaveText('1');
  await expect(page.locator('#stat-lines')).toHaveText('3');
  await expect(page.locator('#results-title')).toHaveText('acme/demo');
  expect(await page.locator('html').evaluate(element => element.getBoundingClientRect().width)).toBe(480);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(context.pages().filter(page => page.url().startsWith(origin))).toHaveLength(1);
  expect(requests).toContain('https://api.github.com/repos/acme/demo/commits/main');
  const requestCount = requests.length;
  expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
  await page.close();
  const reopened = await toolbarClick('https://github.com/acme/demo/issues/1');
  await expect(reopened.locator('#results')).toBeVisible();
  await expect(reopened.locator('#stat-code')).toHaveText('1');
  expect(requests).toHaveLength(requestCount);
  const detailEvent = context.waitForEvent('page');
  await reopened.locator('#open-details').click();
  const detail = await detailEvent;
  await expect(detail.locator('#results')).toBeVisible();
  await expect(detail.locator('#stat-code')).toHaveText('1');
  expect(requests).toHaveLength(requestCount);
  await detail.locator('.language-row').click();
  await expect(detail.locator('.details-table a')).toHaveAttribute('href', 'https://github.com/acme/demo/blob/commit123/src/main.rs');
  const jsonEvent = detail.waitForEvent('download');
  await detail.locator('#download-json').click();
  const json = JSON.parse(await downloadText(await jsonEvent));
  expect(json.results.Total).toEqual({code: 1, comments: 1, blanks: 1, files: 1});
  const csvEvent = detail.waitForEvent('download');
  await detail.locator('#download-csv').click();
  expect(await downloadText(await csvEvent)).toContain('"Rust","src/main.rs","1","1","1","3"');
  expect(await detail.evaluate(() => window.cspViolations)).toEqual([]);
  expect(errors).toEqual([]);
});

test('non-repository pages provide hosting input without local file controls in either view', async () => {
  const page = await toolbarClick('https://example.com/');
  await expect(page.locator('#results')).toBeHidden();
  await expect(page.locator('#repo-url')).toBeVisible();
  await expect(page.locator('.hosting-support')).toContainText('Codeberg');
  await expect(page.locator('#local-panel, #tab-local, input[type=file]')).toHaveCount(0);
  const next = context.waitForEvent('page');
  await page.locator('#open-details').click();
  const detail = await next;
  await expect(detail.locator('#repo-url')).toBeVisible();
  await expect(detail.locator('#local-panel, #tab-local, input[type=file]')).toHaveCount(0);
  expect(await detail.evaluate(() => window.cspViolations)).toEqual([]);
});

test('a different repository never displays a previous repository cache', async () => {
  await context.route('https://api.github.com/**', route => route.fulfill({status: 404, json: {message: 'Not Found'}}));
  const page = await toolbarClick('https://example.com/');
  await page.evaluate(async () => {
    const {saveResult} = await import('./results.js');
    saveResult({title: 'acme/old', detail: {owner: 'acme', repo: 'old'}, results: {Total: {}}, warnings: [], analyzedAt: new Date().toISOString()});
  });
  await page.close();
  const next = await toolbarClick('https://github.com/acme/private');
  await expect(next.locator('#results')).toBeHidden();
  await expect(next.locator('#error-alert')).toContainText('not found or private');
  await expect(next.locator('#analyze-button')).toBeEnabled();
});

test('host browser checks are explained without attempting to parse the challenge as code', async () => {
  await context.route('https://git.sr.ht/**', route => route.request().url().includes('/info/refs?') ?
    route.fulfill({body: refs}) : route.fulfill({status: 418, body: '<html>Checking you are not a bot</html>', contentType: 'text/html'}));
  const page = await toolbarClick('https://git.sr.ht/~alice/demo');
  await expect(page.locator('#error-alert')).toContainText('browser check');
  await expect(page.locator('#results')).toBeHidden();
  await expect(page.locator('#analyze-button')).toBeEnabled();
});

for (const host of ['gitlab.com', 'codeberg.org', 'gitee.com', 'git.sr.ht']) {
  test(`${host} popup runs bundled Wasm and opens links on the same host`, async () => {
    const owner = host === 'git.sr.ht' ? '~alice' : 'acme';
    const root = `https://${host}/${owner}/demo`;
    const requests = [];
    await context.route(`https://${host}/**`, route => {
      const url = route.request().url(); requests.push(url);
      if (url.includes('/info/refs?')) return route.fulfill({body: refs});
      if (url.endsWith('.tar.gz')) return route.fulfill({body: compressedArchive(), contentType: 'application/gzip'});
      if (url.includes('/raw/') || url.endsWith('/blobs/blob1/raw')) return route.fulfill({body: 'fn main() {}\n// hi\n\n'});
      if (url.includes('/repository/tree?')) return route.fulfill({json: url.endsWith('page=1') ? [{path: 'src/main.rs', id: 'blob1', type: 'blob'}] : []});
      if (url.includes('/git/trees/')) return route.fulfill({json: {tree: [{path: 'src/main.rs', type: 'blob'}], truncated: false}});
      if (url.includes('/commits/')) return route.fulfill({json: {sha: revision, id: revision}});
      return route.fulfill({json: {default_branch: 'main'}});
    });
    const page = await toolbarClick(root);
    await expect(page.locator('#results-title')).toHaveText(`${owner}/demo`);
    await expect(page.locator('#stat-code')).toHaveText('1');
    await expect(page.locator('#stat-lines')).toHaveText('3');
    await expect(page.locator('input[type=file]')).toHaveCount(0);
    const count = requests.length;
    await page.close();
    const reopened = await toolbarClick(root + (host === 'gitlab.com' ? '/-/tree/main' : '/tree/main'));
    await expect(reopened.locator('#stat-code')).toHaveText('1');
    expect(requests).toHaveLength(count);
    const next = context.waitForEvent('page');
    await reopened.locator('#open-details').click();
    const detail = await next;
    await expect(detail.locator('#stat-code')).toHaveText('1');
    await detail.locator('.language-row').click();
    const suffix = host === 'gitlab.com' ? `/-/blob/${revision}/src/main.rs` : host === 'codeberg.org' ?
      `/src/commit/${revision}/src/main.rs` : host === 'git.sr.ht' ? `/tree/${revision}/item/src/main.rs` : `/blob/${revision}/src/main.rs`;
    await expect(detail.locator('.details-table a')).toHaveAttribute('href', root + suffix);
    expect(requests).toHaveLength(count);
    expect(await detail.evaluate(() => window.cspViolations)).toEqual([]);
  });
}

for (const granted of [false, true]) {
  test(`custom Forgejo server requests only its own origin (permission ${granted ? 'granted' : 'denied'})`, async () => {
    await context.addInitScript(granted => {
      window.requestedOrigins = [];
      chrome.permissions.request = async request => {window.requestedOrigins.push(...request.origins); return granted;};
    }, granted);
    await context.route('https://git.example.org/**', route => {
      const url = route.request().url();
      if (url.includes('/raw/')) return route.fulfill({body: 'fn main() {}\n'});
      if (url.includes('/git/trees/')) return route.fulfill({json: {tree: [{path: 'main.rs', type: 'blob'}], truncated: false}});
      if (url.includes('/commits/')) return route.fulfill({json: {sha: revision}});
      return route.fulfill({json: {default_branch: 'main'}});
    });
    const page = await toolbarClick('https://example.com');
    await page.locator('#repo-url').fill('https://git.example.org/acme/demo');
    await page.locator('.server-options summary').click();
    await page.locator('#repository-provider').selectOption('forgejo');
    await page.locator('#analyze-button').click();
    if (granted) await expect(page.locator('#stat-code')).toHaveText('1');
    else {
      await expect(page.locator('#error-alert')).toContainText('not granted');
      await expect(page.locator('#results')).toBeHidden();
    }
    expect(await page.evaluate(() => window.requestedOrigins)).toEqual(['https://git.example.org/*']);
    if (granted) {
      await page.close();
      const reopened = await toolbarClick('https://git.example.org/acme/demo/src/branch/main');
      await expect(reopened.locator('#stat-code')).toHaveText('1');
      expect(await reopened.evaluate(() => window.requestedOrigins)).toEqual([]);
    }
  });
}

for (const repository of [
  {provider: 'bitbucket', root: 'https://bitbucket.org/acme/demo', title: 'acme/demo', file: 'src/main.rs', link: `/src/${revision}/src/main.rs`},
  {provider: 'sourceforge', root: 'https://sourceforge.net/p/acme/code', title: 'p/acme/code', file: 'src/main.rs', link: `/ci/${revision}/tree/src/main.rs`},
  ...['', 'datasets/', 'spaces/'].map(prefix => ({provider: 'huggingface', root: `https://huggingface.co/${prefix}acme/demo`,
    title: 'acme/demo', file: 'app.py', link: `/blob/${revision}/app.py`})),
]) {
  test(`${repository.root} supports popup analysis, cache and host-specific detail links`, async () => {
    const requests = [];
    const respond = route => {
      const url = route.request().url(); requests.push(url);
      if (url.includes('/info/refs?')) return route.fulfill({body: refs});
      if (url.includes('?format=raw') || url.includes(`/raw/${revision}/`) || url.endsWith(`/${repository.file}`)) {
        return route.fulfill({body: repository.provider === 'huggingface' ? 'x = 1\n# hi\n\n' : 'fn main() {}\n// hi\n\n'});
      }
      if (repository.provider === 'sourceforge') {
        if (url.includes('/rest/')) return route.fulfill({json: {name: 'git'}});
        return route.fulfill({body: sourceforgeHTML(url.endsWith('/src/') ? [['main.rs']] : [['src', true]]), contentType: 'text/html'});
      }
      if (repository.provider === 'bitbucket') {
        if (url.includes('/refs/branches/')) return route.fulfill({json: {target: {hash: revision}}});
        if (url.includes(`/src/${revision}/`)) return route.fulfill({json: {values: url.includes('/src/?') ?
          [{path: repository.file, type: 'commit_file', size: 20}] : [{path: 'src', type: 'commit_directory'}]}});
        return route.fulfill({json: {scm: 'git', mainbranch: {name: 'main'}}});
      }
      if (url.includes('/tree/')) return route.fulfill({json: [{path: 'app.py', type: 'file', size: 15},
        {path: 'weights.json', type: 'file', size: 1e9, lfs: {size: 1e9}}]});
      return route.fulfill({json: {sha: revision, gated: false, private: false}});
    };
    const hostname = new URL(repository.root).hostname;
    await context.route(`https://${hostname}/**`, respond);
    if (repository.provider === 'bitbucket') await context.route('https://api.bitbucket.org/**', respond);
    if (repository.provider === 'sourceforge') await context.route('https://git.code.sf.net/**', respond);
    const page = await toolbarClick(repository.root);
    await expect(page.locator('#results-title')).toHaveText(repository.title);
    await expect(page.locator('#stat-code')).toHaveText('1');
    await expect(page.locator('#stat-lines')).toHaveText('3');
    if (repository.provider === 'huggingface') {
      await expect(page.locator('#warning-box')).toContainText('Git LFS/Xet assets');
      expect(requests.some(url => url.includes('weights.json'))).toBe(false);
    }
    const count = requests.length;
    await page.close();
    const reopened = await toolbarClick(repository.root);
    await expect(reopened.locator('#stat-code')).toHaveText('1');
    expect(requests).toHaveLength(count);
    const next = context.waitForEvent('page');
    await reopened.locator('#open-details').click();
    const detail = await next;
    await expect(detail.locator('#stat-code')).toHaveText('1');
    await detail.locator('.language-row').click();
    await expect(detail.locator('.details-table a')).toHaveAttribute('href', repository.root + repository.link);
    expect(requests).toHaveLength(count);
    expect(await detail.evaluate(() => window.cspViolations)).toEqual([]);
  });
}

for (const scrollbars of ['system', 'classic']) {
  test(`cold popup keeps its width and scrolls long results with ${scrollbars} scrollbars`, async () => {
    let release;
    const ready = new Promise(resolve => {release = resolve;});
    await context.route('https://api.github.com/**', async route => {
      await ready;
      const url = route.request().url();
      const base = 'https://api.github.com/repos/acme/demo';
      const branch = 'feature/' + 'long-branch-name-'.repeat(15);
      const json = url === base ? {default_branch: branch} : url.includes('/commits/') ?
        {sha: 'commit123', commit: {tree: {sha: 'tree123'}}} :
        {truncated: true, tree: ['rs', 'py', 'js', 'ts', 'rb', 'go', 'c', 'java'].map(ext =>
          ({path: `source.${ext}`, type: 'blob', mode: '100644', size: 2}))};
      await route.fulfill({json});
    });
    await context.route('https://raw.githubusercontent.com/acme/demo/**', route => route.fulfill({body: 'x\n'}));
    const page = await context.newPage();
    // A native popup can start with a tiny viewport before its content is measured.
    await page.setViewportSize({width: 1, height: 600});
    await page.addInitScript(() => {chrome.tabs.query = async () => [{url: 'https://github.com/acme/demo'}];});
    try {
      await page.goto(`${origin}/popup.html`);
      await expect(page.locator('#progress-box')).toBeVisible();
      expect(await page.locator('html').evaluate(element => element.getBoundingClientRect().width)).toBe(480);
      await page.setViewportSize({width: 480, height: 600});
      if (scrollbars === 'classic') {
        await page.addStyleTag({content: 'body::-webkit-scrollbar { width: 16px; }'});
      }
    } finally {release();}
    await expect(page.locator('#results')).toBeVisible();
    await expect(page.locator('#language-chart li')).toHaveCount(8);
    await expect(page.locator('#warning-box')).toBeVisible();
    const before = await page.locator('#repo-url').boundingBox();
    const metrics = await page.evaluate(() => {
      const root = document.documentElement;
      const scroller = document.body;
      const body = scroller.getBoundingClientRect();
      const chart = document.querySelector('#language-chart').getBoundingClientRect();
      const label = document.querySelector('#results-subtitle');
      return {width: root.getBoundingClientRect().width, scrollWidth: scroller.scrollWidth,
        height: scroller.scrollHeight, clientHeight: scroller.clientHeight,
        rightInset: scroller.clientWidth - chart.right,
        bodyWidth: body.width, subtitleFits: label.scrollWidth <= label.clientWidth,
        gutter: getComputedStyle(scroller).scrollbarGutter, scrollbarWidth: scroller.offsetWidth - scroller.clientWidth};
    });
    expect(metrics.width).toBe(480);
    expect(metrics.bodyWidth).toBeLessThanOrEqual(480);
    expect(metrics.scrollWidth).toBeLessThanOrEqual(480);
    expect(metrics.height).toBeGreaterThan(metrics.clientHeight);
    expect(metrics.rightInset).toBeGreaterThanOrEqual(24);
    expect(metrics.subtitleFits).toBe(true);
    expect(metrics.gutter).toBe('stable');
    if (scrollbars === 'classic') expect(metrics.scrollbarWidth).toBeGreaterThan(0);
    await page.evaluate(() => document.body.scrollTo(0, document.body.scrollHeight));
    await expect(page.locator('footer')).toBeInViewport();
    await page.evaluate(() => document.body.scrollTo(0, 0));
    expect((await page.locator('#repo-url').boundingBox()).width).toBe(before.width);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
  });
}
