import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {repositoryFromURL} from '../apps/web/repositories.js';
import {readResult, saveResult, resultRepository, recentResult} from '../packages/extension/results.js';
import {createManifest, targets, version} from '../scripts/lib/manifests.mjs';
import {buildApplications} from '../scripts/build.mjs';

const buildExtensions = options => buildApplications({...options, targets});

const root = fileURLToPath(new URL('../', import.meta.url));
test('toolbar recognizes repository pages and discards branch, query and fragment', () => {
  for (const path of ['', '/', '.git', '/tree/feature/test', '/blob/main/src/lib.rs',
    '/issues/12', '/pull/4/files', '/actions/runs/123', '/releases/tag/v1', '/settings']) {
    assert.equal(repositoryFromURL(`https://github.com/acme/demo${path}?tab=readme#top`), 'acme/demo', path);
  }
  assert.equal(repositoryFromURL('https://github.com/XAMPPRocky/tokei'), 'XAMPPRocky/tokei');
  assert.equal(repositoryFromURL('https://github.com/acme/.github'), 'acme/.github');
});

test('toolbar rejects non-repository, privileged, deceptive and unavailable URLs', () => {
  for (const url of [undefined, null, '', 'not a URL', 'about:blank', 'chrome://extensions/',
    'https://example.com/acme/demo', 'https://github.com.evil.test/acme/demo',
    'http://github.com/acme/demo', 'https://user:secret@github.com/acme/demo',
    'https://github.com:8443/acme/demo', 'https://github.com/', 'https://github.com/acme',
    'https://github.com/settings/profile', 'https://github.com/features/actions',
    'https://github.com/solutions/industry', 'https://github.com/copilot/agents',
    'https://github.com/orgs/acme/repositories', 'https://github.com/search?q=demo',
    'https://github.com/acme/demo/unknown', 'https://github.com/acme/.git',
    'https://github.com/acme/%2E%2E', 'https://github.com/acme/demo%2Ftree']) {
    assert.equal(repositoryFromURL(url), null, String(url));
  }
});

test('completed result cache survives reopening and expires without mixing repositories', () => {
  let value = null;
  const storage = {getItem: () => value, setItem: (_, data) => {value = data;}};
  const now = Date.now();
  const data = {detail: {owner: 'acme', repo: 'demo'}, results: {Total: {code: 1}}, warnings: [], analyzedAt: new Date(now).toISOString()};
  assert.equal(readResult(storage), null);
  const saved = saveResult(data, storage);
  assert.deepEqual(readResult(storage), saved);
  assert.equal(resultRepository(saved), 'acme/demo');
  assert.ok(recentResult(saved, 'ACME/demo', now));
  assert.ok(!recentResult(saved, 'acme/other', now));
  assert.ok(!recentResult(saved, null, now));
  assert.ok(!recentResult(saved, 'acme/demo', now + 300_000));
  assert.ok(!recentResult(saved, 'acme/demo', now - 1));
  value = '{broken';
  assert.equal(readResult(storage), null);
  value = '{"id":"broken","data":{}}';
  assert.equal(readResult(storage), null);
  const unavailable = {getItem() {throw Error('blocked');}, setItem() {throw Error('quota');}};
  assert.equal(readResult(unavailable), null);
  assert.equal(saveResult(data, unavailable), null);
});

test('packages contain runnable browser-specific manifests, real Wasm and licenses', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'tokei-extensions-'));
  try {
    await buildExtensions({outDir: temporary, packageZip: true});
    for (const target of targets) {
      const manifest = JSON.parse(await readFile(join(temporary, target, 'manifest.json'), 'utf8'));
      assert.deepEqual(manifest, createManifest(target));
      assert.equal(manifest.manifest_version, 3);
      assert.deepEqual(manifest.permissions, ['activeTab']);
      assert.ok(manifest.host_permissions.includes('https://codeberg.org/*'));
      assert.ok(manifest.host_permissions.includes('https://gitlab.com/*'));
      assert.ok(manifest.host_permissions.includes('https://git.sr.ht/*'));
      assert.deepEqual(manifest.optional_host_permissions, ['https://*/*']);
      assert.match(manifest.content_security_policy.extension_pages, /'wasm-unsafe-eval'/);
      assert.equal(manifest.action.default_popup, 'popup.html');
      assert.ok(!manifest.background);
      assert.ok(!manifest.content_scripts);
      assert.ok(!manifest.web_accessible_resources);
      if (target === 'chrome') {
        assert.ok(!manifest.browser_specific_settings);
      } else {
        assert.equal(manifest.browser_specific_settings.gecko.id, 'tokei-wasm@kojix2.github.io');
      }
      const wasm = await readFile(join(temporary, target, 'pkg/tokei_wasm_bg.wasm'));
      assert.ok(WebAssembly.validate(wasm));
      for (const name of ['index.html', 'app.js', 'worker.js', 'exclude.js', 'language-colors.js', 'style.css',
        'popup.html', 'popup.css', 'extension-page.js', 'results.js', 'LICENSE', 'third-party/tokei-MIT.txt', 'third-party/tokei-Apache-2.0.txt',
        'third-party/home-MIT.txt', 'third-party/home-Apache-2.0.txt']) {
        assert.ok((await readFile(join(temporary, target, name))).length, name);
      }
      const popup = await readFile(join(temporary, target, 'popup.html'), 'utf8');
      assert.match(popup, /data-extension-view="popup"/);
      assert.match(popup, /src="extension-page.js"/);
      assert.match(popup, /href="popup.css"/);
      assert.doesNotMatch(popup, /local-panel|files-input|folder-input|tab-local|Choose files|Drop a folder/);
      assert.match(popup, /repository-provider/);
      const detail = await readFile(join(temporary, target, 'index.html'), 'utf8');
      assert.match(detail, /data-extension-view="tab"/);
      assert.match(detail, /src="extension-page.js"/);
      assert.doesNotMatch(detail, /local-panel|files-input|folder-input|tab-local/);
      assert.deepEqual(await readdir(join(temporary, target, 'pkg')), ['tokei_wasm.js', 'tokei_wasm_bg.wasm']);
      const archive = join(temporary, `tokei-wasm-${target}-${version}.zip`);
      const listing = spawnSync('unzip', ['-Z1', archive], {encoding: 'utf8'});
      assert.equal(listing.status, 0, listing.stderr);
      assert.ok(listing.stdout.split('\n').includes('manifest.json'));
      assert.ok(listing.stdout.split('\n').includes('pkg/tokei_wasm_bg.wasm'));
      assert.doesNotMatch(listing.stdout, /node_modules|tests\/|\.git|manifest\.mjs/);
      const extracted = spawnSync('unzip', ['-p', archive, 'manifest.json'], {encoding: 'utf8'});
      assert.equal(extracted.status, 0);
      assert.deepEqual(JSON.parse(extracted.stdout), manifest);
    }
    await writeFile(join(temporary, 'chrome', 'stale.txt'), 'stale');
    await buildExtensions({outDir: temporary});
    assert.ok(!(await readdir(join(temporary, 'chrome'))).includes('stale.txt'));
  } finally {await rm(temporary, {recursive: true, force: true});}
});

test('missing or invalid Wasm fails before replacing previous extension output', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'tokei-extension-inputs-'));
  try {
    for (const path of ['apps', 'packages/extension', 'packages/wasm/pkg', 'LICENSE']) {
      await mkdir(join(temporary, path, '..'), {recursive: true});
      await cp(join(root, path), join(temporary, path), {recursive: true});
    }
    const wasm = join(temporary, 'packages/wasm/pkg/tokei_wasm_bg.wasm');
    const outDir = join(temporary, 'dist');
    await buildExtensions({sourceRoot: temporary, outDir});
    await rm(wasm);
    await assert.rejects(buildExtensions({sourceRoot: temporary, outDir}), /Missing or empty build input:.*tokei_wasm_bg\.wasm.*npm run build:wasm/);
    assert.equal(JSON.parse(await readFile(join(outDir, 'chrome/manifest.json'))).version, version);
    await writeFile(wasm, 'invalid Wasm');
    await assert.rejects(buildExtensions({sourceRoot: temporary, outDir}), /WebAssembly is invalid/);
  } finally {await rm(temporary, {recursive: true, force: true});}
});
