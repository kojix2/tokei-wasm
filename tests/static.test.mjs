import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8');

test('source uses original upstream tokei crate, not the C approximation', () => {
  const cargo = read('../wasm/Cargo.toml');
  const lib = read('../wasm/src/lib.rs');
  assert.match(cargo, /tokei\s*=\s*\{\s*version\s*=\s*"=15\.0\.0"/);
  assert.match(lib, /parse_from_slice\(bytes,\s*&Config::default\(\)\)/);
  assert.match(lib, /serde_wasm_bindgen::to_value/);
});

test('browser worker uses generated Rust Wasm and no separate line-counting lexer', () => {
  const worker = read('../docs/worker.js');
  assert.match(worker, /import\('\.\/pkg\/tokei_wasm\.js'\)/);
  assert.match(worker, /wasm\.count_file\(path, bytes\)/);
  assert.doesNotMatch(worker, /lines\.wasm|syntax\.flags/);
});

test('GitHub Actions only deploys after Rust Wasm build and tests', () => {
  const workflow = read('../.github/workflows/pages.yml');
  const build = workflow.indexOf('wasm-pack build');
  const testWasm = workflow.indexOf('node --test');
  const deploy = workflow.indexOf('actions/deploy-pages');
  assert.ok(build > 0 && testWasm > build && deploy > testWasm);
  assert.match(workflow, /test -s docs\/pkg\/tokei_wasm_bg\.wasm/);
});
