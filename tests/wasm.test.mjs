import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {test} from 'node:test';
const jsUrl = new URL('../packages/wasm/pkg/tokei_wasm.js', import.meta.url);
const wasmUrl = new URL('../packages/wasm/pkg/tokei_wasm_bg.wasm', import.meta.url);
const built = existsSync(jsUrl) && existsSync(wasmUrl);
assert.ok(built, 'Rust Wasm artifacts are required. Run npm run build:wasm first.');

// No fake Wasm module and no JS/C lexer: these tests run on the compiled Rust tokei.
test('real upstream Rust tokei Wasm counts Rust lines and nested comments', async () => {
  const tokei = await import(jsUrl.href);
  await tokei.default({module_or_path: readFileSync(wasmUrl)});
  assert.equal(tokei.detect_language('src/main.rs'), 'Rust');
  assert.equal(tokei.detect_language('lib/example.cr'), 'Crystal');
  assert.equal(tokei.detect_language('Rakefile'), 'Ruby');
  assert.equal(tokei.detect_language('Dockerfile'), 'Dockerfile');
  assert.equal(tokei.detect_language('test.unknown-exotic-xyz'), undefined);
  const r = tokei.count_file('lib.rs', new TextEncoder().encode(
    '/* outer /* inner */ outer */\nfn main() {}\n\n'));
  assert.equal(r.language, 'Rust');
  assert.deepEqual({...r.stats}, {code: 1, comments: 1, blanks: 1});
});

test('original Rust tokei handles strings containing comment markers', async () => {
  const tokei = await import(jsUrl.href);
  await tokei.default({module_or_path: readFileSync(wasmUrl)});
  const r = tokei.count_file('sample.rs', new TextEncoder().encode(
    'let s = "// this is part of a string";\n// real comment\n'));
  assert.equal(r.stats.code, 1);
  assert.equal(r.stats.comments, 1);
});

test('upstream fast parser and embedded-language parser run without OS threads', async () => {
  const tokei = await import(jsUrl.href);
  await tokei.default({module_or_path: readFileSync(wasmUrl)});
  const fast = tokei.count_file('main.rs', new TextEncoder().encode('fn a() {}\nfn b() {}\n/* block */\n'));
  assert.deepEqual({...fast.stats}, {code: 2, comments: 1, blanks: 0});
  const embedded = tokei.count_file('index.html', new TextEncoder().encode('<script>\n// hi\nconst x = 1;\n</script>\n'));
  assert.ok(embedded.embedded.some(item => item.language === 'JavaScript' && item.stats.code === 1 && item.stats.comments === 1));
  assert.equal(tokei.detect_language('main.C'), 'C');
  assert.equal(tokei.detect_language('main.RS'), 'Rust');
});
