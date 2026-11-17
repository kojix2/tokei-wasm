import {test, expect, chromium} from '@playwright/test';
import {fileURLToPath} from 'node:url';

const extensionPath = fileURLToPath(new URL('../../dist/chrome', import.meta.url));
const colorURL = 'https://raw.githubusercontent.com/ozh/github-colors/master/colors.json';
let context, background, origin;

test.beforeEach(async () => {
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true, acceptDownloads: true,
    ...(process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {}),
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  await context.addInitScript(() => {
    window.cspViolations = [];
    document.addEventListener('securitypolicyviolation', event => window.cspViolations.push(event.violatedDirective));
  });
  background = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  origin = `chrome-extension://${new URL(background.url()).hostname}`;
  await context.route(colorURL, route => route.fulfill({json: {Rust: {color: '#dea584'}}}));
});
test.afterEach(async () => {await context?.close();});

// Invoke the same production handler from an extension page. Browser toolbar
// controls are outside Playwright's page automation surface; Node tests also
// verify that the background's listener registration invokes this handler.
async function toolbarClick(url) {
  const launcher = await context.newPage();
  await launcher.goto(`${origin}/index.html`);
  const [, page] = await Promise.all([
    launcher.evaluate(async url => {
      const {openAnalyzer} = await import('./action.js');
      await openAnalyzer(chrome, {url});
    }, url),
    context.waitForEvent('page'),
  ]);
  await launcher.close();
  await page.waitForLoadState('domcontentloaded');
  return page;
}
async function downloadText(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

test('toolbar launches GitHub analysis using the default branch and bundled Wasm', async () => {
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
  await expect(page).toHaveURL(`${origin}/index.html?repo=acme%2Fdemo`);
  await expect(page.locator('#results')).toBeVisible();
  await expect(page.locator('#stat-code')).toHaveText('1');
  await expect(page.locator('#stat-lines')).toHaveText('3');
  await expect(page.locator('#results-title')).toHaveText('acme/demo');
  await page.locator('.language-row').click();
  await expect(page.locator('.details-table a')).toHaveAttribute('href', 'https://github.com/acme/demo/blob/commit123/src/main.rs');
  expect(requests).toContain('https://api.github.com/repos/acme/demo/commits/main');
  expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
  expect(errors).toEqual([]);
});

test('non-GitHub toolbar launch supports offline local analysis and both exports', async () => {
  await context.route('https://**/*', route => route.abort());
  const page = await toolbarClick('https://example.com/');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await expect(page).toHaveURL(`${origin}/index.html`);
  await expect(page.locator('#results')).toBeHidden();
  await page.locator('#tab-local').click();
  await page.locator('#files-input').setInputFiles({name: 'main.rs', mimeType: 'text/plain', buffer: Buffer.from('fn main() {}\n// hi\n\n')});
  await expect(page.locator('#results')).toBeVisible();
  await expect(page.locator('#stat-code')).toHaveText('1');
  await expect(page.locator('#stat-lines')).toHaveText('3');
  const jsonEvent = page.waitForEvent('download');
  await page.locator('#download-json').click();
  const json = JSON.parse(await downloadText(await jsonEvent));
  expect(json.results.Total).toEqual({code: 1, comments: 1, blanks: 1, files: 1});
  const csvEvent = page.waitForEvent('download');
  await page.locator('#download-csv').click();
  expect(await downloadText(await csvEvent)).toContain('"Rust","main.rs","1","1","1","3"');
  expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
  expect(errors).toEqual([]);
});
