import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildApplications} from '../scripts/build.mjs';

test('all three distributions use identical shared runtime and engine assets', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'tokei-apps-'));
  try {
    await buildApplications({outDir: temporary});
    for (const file of ['app.js', 'worker.js', 'pkg/tokei_wasm.js', 'pkg/tokei_wasm_bg.wasm']) {
      const web = await readFile(join(temporary, 'web', file));
      assert.deepEqual(await readFile(join(temporary, 'chrome', file)), web, `Chrome ${file}`);
      assert.deepEqual(await readFile(join(temporary, 'firefox', file)), web, `Firefox ${file}`);
    }
    const web = await readdir(join(temporary, 'web'));
    const webHTML = await readFile(join(temporary, 'web/index.html'), 'utf8');
    assert.match(webHTML, /id="local-panel"/);
    assert.doesNotMatch(webHTML, /id="open-details"|id="repository-provider"|id="popup-message"|<!-- (web|extension|full|popup)-only -->/);
    assert.ok(web.includes('.nojekyll'));
    assert.ok(!web.includes('manifest.json'));
    assert.ok(!web.includes('background.js'));
    for (const target of ['chrome', 'firefox']) {
      const files = await readdir(join(temporary, target));
      assert.ok(files.includes('manifest.json'));
      assert.ok(files.includes('popup.html'));
      assert.ok(!files.includes('background.js'));
      assert.ok(!files.includes('.nojekyll'));
      const html = await readFile(join(temporary, target, 'popup.html'), 'utf8');
      assert.match(html, /id="open-details"/);
      assert.match(html, /id="refresh"/);
      assert.match(html, /id="popup-message"/);
      assert.doesNotMatch(html, /id="local-panel"|id="repo-url"|id="repository-provider"|<footer>|<!-- (web|extension|full|popup)-only -->/);
      const detailHTML = await readFile(join(temporary, target, 'index.html'), 'utf8');
      assert.match(detailHTML, /id="repo-url"/);
      assert.match(detailHTML, /id="repository-provider"/);
      assert.doesNotMatch(detailHTML, /id="popup-message"|<!-- (web|extension|full|popup)-only -->/);
    }
    await writeFile(join(temporary, 'web', 'keep.txt'), 'web output');
    await buildApplications({outDir: temporary, targets: ['chrome', 'firefox']});
    assert.equal(await readFile(join(temporary, 'web', 'keep.txt'), 'utf8'), 'web output');
    await writeFile(join(temporary, 'chrome', 'keep.txt'), 'extension output');
    await buildApplications({outDir: temporary, targets: ['web']});
    assert.equal(await readFile(join(temporary, 'chrome', 'keep.txt'), 'utf8'), 'extension output');
    await assert.rejects(buildApplications({outDir: temporary, targets: ['unknown']}), /Unknown app target/);
  } finally {await rm(temporary, {recursive: true, force: true});}
});
