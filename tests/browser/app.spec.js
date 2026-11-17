import {test, expect} from '@playwright/test';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const source = (name, text) => ({name, mimeType: 'text/plain', buffer: Buffer.from(text)});
const samples = [source('main.rs', 'fn main() {}\n// comment\n\n'), source('test.py', 'x = 1\n# comment\n\n')];
const colorURL = 'https://raw.githubusercontent.com/ozh/github-colors/master/colors.json';
const testColors = {
  Rust: {color: '#dea584'}, Python: {color: '#3572A5'}, JavaScript: {color: '#f1e05a'},
  TypeScript: {color: '#3178c6'}, 'C++': {color: '#f34b7d'},
};
async function selectFiles(page, files = samples) {
  await page.locator('#tab-local').click();
  await page.locator('#files-input').setInputFiles(files);
  await expect(page.locator('#progress-box')).toBeHidden();
  await expect(page.locator('#error-alert')).toBeHidden();
  await expect(page.locator('#results')).toBeVisible();
}
async function downloadText(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

test.beforeEach(async ({page}) => {
  await page.route(colorURL, route => route.fulfill({json: testColors}));
  await page.goto('/');
});

test('local analysis, details, search, sorting, and exports', async ({page}) => {
  const errors = [];
  const externalRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (new URL(request.url()).origin !== new URL(page.url()).origin && request.url() !== colorURL) externalRequests.push(request.url());
  });
  await selectFiles(page, [...samples, source('binary.rs', '\0binary')]);
  await expect(page.locator('#stat-code')).toHaveText('2');
  await expect(page.locator('#stat-files')).toHaveText('2');
  await expect(page.locator('#stat-lines')).toHaveText('6');
  await expect(page.locator('#composition-chart')).toHaveAttribute('aria-label', 'Code 33% · Comments 33% · Blanks 33%');
  await expect(page.locator('#chart-lines')).toHaveText('6');
  await expect(page.locator('#language-chart li')).toHaveCount(2);
  await expect(page.locator('#language-chart')).toContainText('Rust');
  await expect(page.locator('#composition-legend')).toContainText('Comments');
  for (const [name, color] of [['Rust', 'rgb(222, 165, 132)'], ['Python', 'rgb(53, 114, 165)']]) {
    await expect(page.locator('#language-chart li').filter({hasText: name}).locator('.bar-track span')).toHaveCSS('background-color', color);
    await expect(page.locator('.language-row').filter({hasText: name}).locator('.language-swatch')).toHaveCSS('background-color', color);
    await expect(page.locator('.language-row').filter({hasText: name}).locator('.language-swatch')).toHaveAttribute('aria-hidden', 'true');
  }
  await expect(page.locator('#warning-box')).toContainText('1 binary or unreadable');
  const row = page.locator('.language-row').filter({hasText: 'Rust'});
  await row.click();
  await expect(page.locator('.details-table')).toContainText('main.rs');
  await row.press('Enter');
  await expect(page.locator('.details-table')).toHaveCount(0);
  await page.locator('[data-sort="name"]').click();
  await expect(page.locator('.language-row').first()).toContainText('Python');
  await page.locator('#language-search').fill('main.rs');
  await expect(page.locator('.language-row')).toHaveCount(1);
  await expect(page.locator('.details-table')).toContainText('main.rs');
  await page.locator('#language-search').fill('no-matches');
  await expect(page.locator('.empty-state')).toHaveText('No matching languages or files.');
  await page.locator('#language-search').fill('');
  const jsonEvent = page.waitForEvent('download');
  await page.locator('#download-json').click();
  const json = JSON.parse(await downloadText(await jsonEvent));
  expect(json.results.Total).toEqual({code: 2, comments: 2, blanks: 2, files: 2});
  expect(json.skipped).toBe(1);
  expect(json.engine).toContain('Rust tokei');
  const csvEvent = page.waitForEvent('download');
  await page.locator('#download-csv').click();
  const csv = await downloadText(await csvEvent);
  expect(csv).toContain('"Rust","main.rs","1","1","1","3"');
  expect(csv).toContain('"Python","test.py","1","1","1","3"');
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('charts update with new results and handle files with no lines or code', async ({page}) => {
  await selectFiles(page);
  await selectFiles(page, [source('only.rs', 'fn a() {}\nfn b() {}\n// comment\n')]);
  await expect(page.locator('#language-chart li')).toHaveCount(1);
  await expect(page.locator('#language-chart li')).toHaveAttribute('aria-label', 'Rust: 2 lines of code');
  await expect(page.locator('#composition-chart')).toHaveAttribute('aria-label', 'Code 67% · Comments 33% · Blanks 0%');
  await expect(page.locator('#chart-lines')).toHaveText('3');
  await selectFiles(page, [source('empty.rs', '')]);
  await expect(page.locator('#chart-lines')).toHaveText('0');
  await expect(page.locator('#composition-chart')).toHaveAttribute('aria-label', 'Code 0% · Comments 0% · Blanks 0%');
  await expect(page.locator('#language-chart li')).toHaveAttribute('aria-label', 'Rust: 0 lines of code');
  await selectFiles(page, [source('comments.rs', '// comment\n\n')]);
  await expect(page.locator('#chart-lines')).toHaveText('2');
  await expect(page.locator('#composition-chart')).toHaveAttribute('aria-label', 'Code 0% · Comments 50% · Blanks 50%');
});

test('language chart shows the top eight without changing when the table is filtered', async ({page}) => {
  const extensions = ['rs', 'py', 'js', 'ts', 'css', 'rb', 'cr', 'go', 'c', 'java'];
  await selectFiles(page, extensions.map((extension, index) => source(`source.${extension}`, 'x\n'.repeat(10 - index))));
  await expect(page.locator('#stat-languages')).toHaveText('10');
  await expect(page.locator('#language-chart li')).toHaveCount(8);
  await expect(page.locator('#language-chart li').first()).toHaveAttribute('aria-label', 'Rust: 10 lines of code');
  await expect(page.locator('#language-chart li').last()).toHaveAttribute('aria-label', 'Go: 3 lines of code');
  await page.locator('#language-search').fill('Java');
  await expect(page.locator('#language-chart li')).toHaveCount(8);
});

test('language variants use GitHub colors consistently after sorting and filtering', async ({page}) => {
  await selectFiles(page, [source('component.jsx', 'const app = <div />;\n'), source('module.hpp', 'int x;\n'), source('app.tsx', 'const app = <div />;\n')]);
  const colors = [['JSX', 'rgb(241, 224, 90)'], ['C++ Header', 'rgb(243, 75, 125)'], ['TSX', 'rgb(49, 120, 198)']];
  await page.locator('[data-sort="name"]').click();
  for (const [name, color] of colors) {
    await expect(page.locator('#language-chart li').filter({hasText: name}).locator('.bar-track span')).toHaveCSS('background-color', color);
    await page.locator('#language-search').fill(name);
    await expect(page.locator('.language-row')).toHaveCount(1);
    await expect(page.locator('.language-swatch')).toHaveCSS('background-color', color);
  }
  await page.locator('#language-search').fill('');
  await expect(page.locator('.language-swatch')).toHaveCount(3);
});

test('a failed palette request leaves local analysis usable in gray', async ({page}) => {
  await page.route(colorURL, route => route.abort());
  await page.reload();
  await selectFiles(page);
  await expect(page.locator('#stat-code')).toHaveText('2');
  await expect(page.locator('.language-swatch').first()).toHaveCSS('background-color', 'rgb(133, 133, 133)');
  await expect(page.locator('.bar-track span').first()).toHaveCSS('background-color', 'rgb(133, 133, 133)');
});

test('late colors update results without blocking local analysis', async ({page}) => {
  let releaseColors;
  const released = new Promise(resolve => {releaseColors = resolve;});
  await page.route(colorURL, async route => {await released; await route.fulfill({json: testColors});});
  await page.reload({waitUntil: 'domcontentloaded'});
  try {
    await selectFiles(page);
    await expect(page.locator('.language-swatch').first()).toHaveCSS('background-color', 'rgb(133, 133, 133)');
    const row = page.locator('.language-row').first();
    await row.click();
    releaseColors();
    await expect(page.locator('.language-swatch').first()).toHaveCSS('background-color', 'rgb(222, 165, 132)');
    await expect(page.locator('.bar-track span').first()).toHaveCSS('background-color', 'rgb(222, 165, 132)');
    await expect(row).toBeFocused();
    await expect(page.locator('.details-table')).toBeVisible();
  } finally {releaseColors();}
});

test('folder selection excludes dependencies and retains relative filenames', async ({page}) => {
  const temporary = await mkdtemp(join(tmpdir(), 'tokei-browser-'));
  const folder = join(temporary, 'sample-project');
  try {
    await mkdir(join(folder, 'src'), {recursive: true});
    await mkdir(join(folder, 'node_modules'), {recursive: true});
    await writeFile(join(folder, 'src', 'main.rs'), 'fn main() {}\n');
    await writeFile(join(folder, 'node_modules', 'ignored.rs'), 'ignore\nignore\n');
    await page.locator('#tab-local').click();
    await page.locator('#folder-input').setInputFiles(folder);
    await expect(page.locator('#results')).toBeVisible();
    await expect(page.locator('#stat-code')).toHaveText('1');
    await expect(page.locator('#results-title')).toHaveText('sample-project');
    await page.locator('.language-row').click();
    await expect(page.locator('.details-table')).toContainText('sample-project/src/main.rs');
  } finally {await rm(temporary, {recursive: true, force: true});}
});

test('drop files and safely export spreadsheet-sensitive filenames', async ({page}) => {
  await page.locator('#tab-local').click();
  await page.locator('#drop-zone').evaluate(element => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['let value = 1;\n'], '=formula.rs', {type: 'text/plain'}));
    element.dispatchEvent(new DragEvent('drop', {dataTransfer: transfer, bubbles: true, cancelable: true}));
  });
  await expect(page.locator('#results')).toBeVisible();
  await expect(page.locator('#stat-code')).toHaveText('1');
  const event = page.waitForEvent('download');
  await page.locator('#download-csv').click();
  expect(await downloadText(await event)).toContain('"\'=formula.rs"');
});

test('invalid sources report errors and the same file can be selected again', async ({page}) => {
  await page.locator('#repo-url').fill('https://example.com/no/repo');
  await page.locator('#analyze-button').click();
  await expect(page.locator('#error-alert')).toContainText('public GitHub repositories');
  await expect(page.locator('#analyze-button')).toBeEnabled();
  await page.locator('#tab-local').click();
  await page.locator('#files-input').setInputFiles(source('unknown.not-supported-xyz', 'hello'));
  await expect(page.locator('#error-alert')).toContainText('No supported');
  await selectFiles(page, [samples[0]]);
  await selectFiles(page, [samples[0]]);
  await expect(page.locator('#stat-files')).toHaveText('1');
});

test('dropped folders read every directory batch and skip dependency trees', async ({page}) => {
  await page.locator('#tab-local').click();
  await page.locator('#drop-zone').evaluate(element => {
    const fileEntry = (path, text) => ({isFile: true, fullPath: path,
      file: resolve => resolve(new File([text], path.split('/').pop()))});
    const folderEntry = (path, batches) => ({isDirectory: true, fullPath: path,
      createReader: () => {let index = 0;return {readEntries: resolve => resolve(batches[index++] || [])};}});
    const root = folderEntry('/dropped-project', [
      [folderEntry('/dropped-project/src', [[fileEntry('/dropped-project/src/main.rs', 'fn main() {}\n')]])],
      [fileEntry('/dropped-project/test.py', 'x = 1\n'),
        folderEntry('/dropped-project/node_modules', [[fileEntry('/dropped-project/node_modules/ignored.rs', 'ignored\n')]])],
    ]);
    const event = new Event('drop', {bubbles: true, cancelable: true});
    Object.defineProperty(event, 'dataTransfer', {value: {items: [{webkitGetAsEntry: () => root}], files: [], types: ['Files']}});
    element.dispatchEvent(event);
  });
  await expect(page.locator('#results')).toBeVisible();
  await expect(page.locator('#results-title')).toHaveText('dropped-project');
  await expect(page.locator('#stat-files')).toHaveText('2');
  await expect(page.locator('#stat-code')).toHaveText('2');
  await page.locator('#language-search').fill('src/main.rs');
  await expect(page.locator('.details-table')).toContainText('dropped-project/src/main.rs');
});

test('GitHub deep link analyzes a pinned revision and renders source links', async ({page}) => {
  const base = 'https://api.github.com/repos/acme/demo';
  await page.context().route('https://api.github.com/**', async route => {
    const url = route.request().url();
    const data = url === base ? {default_branch: 'main'} : url === `${base}/commits/main` ?
      {sha: 'commit123', commit: {tree: {sha: 'tree123'}}} : {tree: [{path: 'src/main.rs', type: 'blob', mode: '100644', size: 30}]};
    await route.fulfill({json: data});
  });
  await page.context().route('https://raw.githubusercontent.com/**', route => route.fulfill({body: 'fn main() {}\n// hi\n'}));
  await page.goto('/?repo=acme/demo');
  await expect(page.locator('#results-title')).toHaveText('acme/demo');
  await expect(page.locator('#stat-code')).toHaveText('1');
  await page.locator('.language-row').click();
  await expect(page.locator('.details-table a')).toHaveAttribute('href', 'https://github.com/acme/demo/blob/commit123/src/main.rs');
});

test('canceling a pending request allows a fresh local analysis', async ({page}) => {
  let entered, finish;
  const started = new Promise(resolve => {entered = resolve;});
  const release = new Promise(resolve => {finish = resolve;});
  await page.context().route('https://api.github.com/**', async route => {
    entered();
    await release;
    await route.fulfill({json: {default_branch: 'main'}}).catch(() => {});
  });
  await page.locator('#repo-url').fill('acme/demo');
  await page.locator('#analyze-button').click();
  await started;
  await expect(page.locator('#choose-files')).toBeDisabled();
  await page.locator('#cancel').click();
  finish();
  await expect(page.locator('#progress-box')).toBeHidden();
  await expect(page.locator('#results')).toBeHidden();
  await selectFiles(page, [samples[0]]);
  await expect(page.locator('#results-title')).toHaveText('Local files');
  await expect(page.locator('#stat-code')).toHaveText('1');
});

test('tabs work from the keyboard and engine failures can be retried', async ({page}) => {
  await page.locator('#tab-github').focus();
  await page.locator('#tab-github').press('ArrowRight');
  await expect(page.locator('#tab-local')).toBeFocused();
  await expect(page.locator('#local-panel')).toBeVisible();
  await page.context().route('**/pkg/tokei_wasm_bg.wasm', route => route.fulfill({status: 404, body: 'missing'}), {times: 1});
  await page.locator('#files-input').setInputFiles(samples[0]);
  await expect(page.locator('#error-alert')).toContainText('Cannot load Rust tokei Wasm');
  await selectFiles(page, [samples[0]]);
  await expect(page.locator('#stat-code')).toHaveText('1');
});
