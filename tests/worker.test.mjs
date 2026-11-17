import assert from 'node:assert/strict';
import {after, before, beforeEach, test} from 'node:test';
import {readFileSync} from 'node:fs';

const wasm = readFileSync(new URL('../packages/wasm/pkg/tokei_wasm_bg.wasm', import.meta.url));
const originalFetch = globalThis.fetch;
const originalSelf = globalThis.self;
let messages, onMessage, route;
const file = (name, content) => {
  const bytes = new TextEncoder().encode(content);
  return {name, size: bytes.length, arrayBuffer: async () => bytes.buffer};
};
const last = () => messages.findLast(m => m.type === 'result' || m.type === 'error');

before(async () => {
  globalThis.self = {
    postMessage: message => messages.push(message),
    addEventListener: (kind, callback) => {if (kind === 'message') onMessage = callback;},
  };
  globalThis.fetch = async (url, options) => String(url).endsWith('/pkg/tokei_wasm_bg.wasm') ?
    new Response(wasm, {headers: {'content-type': 'application/wasm'}}) : route(String(url), options);
  await import('../dist/web/worker.js');
});
beforeEach(() => {
  messages = [];
  route = url => {throw Error(`Unexpected URL: ${url}`);};
});
after(() => {globalThis.fetch = originalFetch; globalThis.self = originalSelf;});

function github(files, {truncated = false} = {}) {
  route = async url => {
    if (url === 'https://api.github.com/repos/acme/demo') return Response.json({default_branch: 'feature/test'});
    if (url.endsWith('/commits/feature%2Ftest')) return Response.json({sha: 'commit123', commit: {tree: {sha: 'tree123'}}});
    if (url.endsWith('/git/trees/tree123?recursive=1')) return Response.json({truncated,
      tree: Object.keys(files).map(path => ({path, size: 10, type: 'blob', mode: '100644'}))});
    const rawPrefix = 'https://raw.githubusercontent.com/acme/demo/commit123/';
    if (url.startsWith(rawPrefix)) {
      const content = files[decodeURIComponent(url.slice(rawPrefix.length))];
      return content instanceof Response ? content : new Response(content);
    }
    throw Error(`Unexpected URL: ${url}`);
  };
}

test('GitHub analysis uses one revision and returns real Rust Wasm counts', async () => {
  github({'src/lib.rs': 'fn hi() {}\n// comment\n', 'README.md': 'hello\nworld\n', 'target/ignored.rs': 'ignored'});
  await onMessage({data: {type: 'github', id: 1, url: 'https://github.com/acme/demo.git'}});
  const result = last();
  assert.equal(result.type, 'result', result.message);
  assert.equal(result.id, 1);
  assert.equal(result.data.results.Rust.code, 1);
  assert.equal(result.data.results.Rust.comments, 1);
  assert.equal(result.data.results.Total.files, 2);
  assert.equal(result.data.detail.revision, 'commit123');
  assert.equal(result.data.detail.ref, 'feature/test');
  assert.match(result.data.engine, /Rust tokei/);
});

test('GitHub partial failures and truncated trees are visible and counted', async () => {
  github({'ok.py': 'x = 1\n', 'broken.rs': new Response('missing', {status: 404}), 'binary.rs': new Uint8Array([0])}, {truncated: true});
  await onMessage({data: {type: 'github', url: 'acme/demo'}});
  const result = last();
  assert.equal(result.type, 'result', result.message);
  assert.equal(result.data.results.Total.files, 1);
  assert.equal(result.data.skipped, 2);
  assert.match(result.data.warnings.join(' '), /truncated/);
  assert.match(result.data.warnings.join(' '), /Unable to analyze 2/);
});

test('downloads enforce the per-file limit even with inaccurate tree sizes', async () => {
  github({'ok.rs': 'fn hi() {}\n', 'huge.rs': new Uint8Array(1_500_001).fill(65)});
  await onMessage({data: {type: 'github', url: 'acme/demo'}});
  assert.equal(last().data.results.Total.files, 1);
  assert.equal(last().data.skipped, 1);
  assert.match(last().data.warnings.join(' '), /1.5 MB limit/);
});

test('local files preserve paths and continue past binary or unreadable files', async () => {
  await onMessage({data: {type: 'local', files: [
    {file: file('test.py', 'x = 1\n# hello\n\n'), path: 'project/test.py'},
    {file: file('ignored.rs', 'ignored'), path: 'project/node_modules/ignored.rs'},
    file('binary.rs', '\0binary'),
    {name: 'broken.py', size: 1, arrayBuffer: async () => {throw Error('permission denied');}},
    file('unknown.xyz-unknown', 'ignored'),
  ]}});
  const result = last();
  assert.equal(result.type, 'result', result.message);
  assert.deepEqual(result.data.results.Python.reports[0].stats, {code: 1, comments: 1, blanks: 1});
  assert.equal(result.data.results.Python.reports[0].name, 'project/test.py');
  assert.equal(result.data.title, 'project');
  assert.equal(result.data.results.Total.files, 1);
  assert.equal(result.data.skipped, 2);
  assert.match(result.data.warnings.join(' '), /permission denied/);
});

test('unsupported and entirely binary selections return useful errors', async () => {
  await onMessage({data: {type: 'local', files: [file('unknown.zzzz-unknown', 'x')]}});
  assert.equal(last().type, 'error');
  assert.match(last().message, /No supported/);
  await onMessage({data: {type: 'local', files: [file('binary.rs', '\0')]}});
  assert.equal(last().type, 'error');
  assert.match(last().message, /No readable/);
});

test('local count and size limits skip excess files without reading them', async () => {
  const files = Array.from({length: 1201}, (_, i) => file(`${i}.rs`, '// hi\n'));
  files.unshift({name: 'huge.rs', size: 1_500_001, arrayBuffer: () => {throw Error('must not read');}});
  await onMessage({data: {type: 'local', files}});
  assert.equal(last().data.results.Total.files, 1200);
  assert.equal(last().data.skipped, 2);
});

test('canceling during a local read suppresses stale progress and results', async () => {
  let release, entered;
  const reading = new Promise(resolve => {entered = resolve;});
  const pending = onMessage({data: {type: 'local', id: 7, files: [{name: 'slow.rs', size: 1,
    arrayBuffer: () => {entered(); return new Promise(resolve => {release = resolve;});}}]}});
  await reading;
  await onMessage({data: {type: 'cancel'}});
  messages = [];
  release(new Uint8Array([65]).buffer);
  await pending;
  assert.deepEqual(messages, []);
  await onMessage({data: {type: 'local', id: 8, files: [file('new.rs', 'fn hi() {}\n')]}});
  assert.equal(last().type, 'result');
  assert.equal(last().id, 8);
});

test('invalid URLs and GitHub failures produce actionable errors', async () => {
  for (const url of ['https://example.com/a/b', 'https://github.com/a/b/tree/main', 'https://user:pass@github.com/a/b']) {
    await onMessage({data: {type: 'github', url}});
    assert.equal(last().type, 'error');
  }
  route = () => new Response('', {status: 403});
  await onMessage({data: {type: 'github', url: 'acme/demo'}});
  assert.match(last().message, /rate limit/);
  route = () => new Response('', {status: 409});
  await onMessage({data: {type: 'github', url: 'acme/demo'}});
  assert.match(last().message, /empty/);
});
