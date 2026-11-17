import assert from 'node:assert/strict';
import {after, before, beforeEach, test} from 'node:test';
import {readFileSync} from 'node:fs';
import {compressedArchive, refs, revision} from './helpers/archive.mjs';
import {sourceforgeHTML} from './helpers/sourceforge.mjs';

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

test('GitLab follows all tree pages and fetches immutable blobs for nested namespaces', async () => {
  const requests = [];
  route = async url => {
    requests.push(url);
    const base = 'https://gitlab.com/api/v4/projects/team%2Fsubgroup%2Fdemo';
    if (url === base) return Response.json({default_branch: 'feature/test'});
    if (url === `${base}/repository/commits/feature%2Ftest`) return Response.json({id: revision});
    if (url.includes('/repository/tree?')) return Response.json(url.endsWith('page=1') ?
      [{id: 'blob1', path: 'src/main.rs', mode: '100644', type: 'blob'}] : url.endsWith('page=2') ?
      [{id: 'blob2', path: 'lib.py', mode: '100644', type: 'blob'}] : []);
    if (url.endsWith('/repository/blobs/blob1/raw')) return new Response('fn main() {}\n// hi\n');
    if (url.endsWith('/repository/blobs/blob2/raw')) return new Response('x = 1\n');
    throw Error(`Unexpected URL ${url}`);
  };
  await onMessage({data: {type: 'repository', url: 'https://gitlab.com/team/subgroup/demo/-/tree/main'}});
  assert.equal(last().type, 'result', last().message);
  assert.equal(last().data.results.Total.files, 2);
  assert.equal(last().data.results.Total.code, 2);
  assert.equal(last().data.detail.provider, 'gitlab');
  assert.equal(last().data.detail.revision, revision);
  assert.ok(requests.some(url => url.endsWith('page=3')));
  assert.ok(requests.filter(url => url.includes('/repository/tree?')).every(url => url.includes(`ref=${revision}`)));
});

test('Forgejo handles server-clamped tree page sizes, immutable downloads and symlinks', async () => {
  const requests = [];
  route = async url => {
    requests.push(url);
    const base = 'https://codeberg.org/api/v1/repos/acme/demo';
    if (url === base) return Response.json({default_branch: 'main'});
    if (url === `${base}/git/commits/main`) return Response.json({sha: revision});
    if (url.includes('/git/trees/')) return Response.json({total_count: 3, truncated: true,
      tree: url.endsWith('page=1') ? [{path: 'src/a b.rs', type: 'blob', mode: '100644', size: 20},
        {path: 'link.rs', type: 'blob', mode: '120000', size: 2}] :
        [{path: 'lib.py', type: 'blob', mode: '100644', size: 10}]});
    if (url.includes('/raw/')) return new Response('x\n');
    throw Error(`Unexpected URL ${url}`);
  };
  await onMessage({data: {type: 'repository', url: 'https://codeberg.org/acme/demo/src/branch/other'}});
  assert.equal(last().type, 'result', last().message);
  assert.equal(last().data.results.Total.files, 2);
  assert.ok(requests.some(url => url.endsWith('page=2')));
  assert.ok(requests.includes(`https://codeberg.org/api/v1/repos/acme/demo/raw/src/a%20b.rs?ref=${revision}`));
});

test('custom GitLab and Forgejo servers use only the selected origin', async () => {
  for (const provider of ['gitlab', 'forgejo']) {
    const requests = [];
    route = async url => {
      requests.push(url);
      if (url.includes('/tree?')) return Response.json(url.endsWith('page=1') ? [{path: 'main.rs', id: 'blob', type: 'blob'}] : []);
      if (url.includes('/git/trees/')) return Response.json({tree: [{path: 'main.rs', type: 'blob'}], truncated: false});
      if (url.endsWith('/commits/main')) return Response.json({id: revision, sha: revision});
      if (url.includes('/raw')) return new Response('fn main() {}\n');
      return Response.json({default_branch: 'main'});
    };
    await onMessage({data: {type: 'repository', url: 'https://git.example.org/acme/demo', provider}});
    assert.equal(last().type, 'result', last().message);
    assert.ok(requests.every(url => new URL(url).origin === 'https://git.example.org'));
  }
});

test('Gitee uses public raw URLs at the pinned commit instead of authenticated raw API', async () => {
  const requests = [];
  route = async url => {
    requests.push(url);
    if (url === 'https://gitee.com/api/v5/repos/acme/demo') return Response.json({default_branch: 'master'});
    if (url.endsWith('/commits/master')) return Response.json({sha: revision});
    if (url.includes('/git/trees/')) return Response.json({tree: [{path: 'main.rs', type: 'blob'}], truncated: true});
    if (url === `https://gitee.com/acme/demo/raw/${revision}/main.rs`) return new Response('fn main() {}\n');
    throw Error(`Unexpected URL ${url}`);
  };
  await onMessage({data: {type: 'repository', url: 'https://gitee.com/acme/demo'}});
  assert.equal(last().type, 'result', last().message);
  assert.equal(last().data.results.Total.code, 1);
  assert.match(last().data.warnings[0], /Gitee truncated/);
  assert.ok(!requests.some(url => url.includes('/api/v5/repos/acme/demo/raw')));
});

test('sourcehut reads public Git refs and a bounded commit archive without GraphQL authentication', async () => {
  const requests = [];
  route = async url => {
    requests.push(url);
    if (url.endsWith('/info/refs?service=git-upload-pack')) return new Response(refs);
    if (url.endsWith(`/archive/${revision}.tar.gz`)) return new Response(compressedArchive());
    throw Error(`Unexpected URL ${url}`);
  };
  await onMessage({data: {type: 'repository', url: 'https://git.sr.ht/~alice/demo/tree/other'}});
  assert.equal(last().type, 'result', last().message);
  assert.equal(last().data.results.Rust.code, 1);
  assert.equal(last().data.results.Rust.comments, 1);
  assert.equal(last().data.detail.revision, revision);
  assert.equal(last().data.detail.ref, 'main');
  assert.equal(last().data.results.Rust.reports[0].name, 'src/main.rs');
  assert.equal(requests.length, 2);
});

test('Bitbucket walks all directory pages at the default-branch commit and ignores links/build directories', async () => {
  const requests = [];
  const base = 'https://api.bitbucket.org/2.0/repositories/acme/demo';
  route = async url => {
    requests.push(url);
    if (url === base) return Response.json({scm: 'git', mainbranch: {name: 'feature/test'}});
    if (url === base + '/refs/branches/feature%2Ftest') return Response.json({target: {hash: revision}});
    if (url === `${base}/src/${revision}/?pagelen=100`) return Response.json({values: [
      {path: 'src', type: 'commit_directory'}, {path: 'node_modules', type: 'commit_directory'},
      {path: 'link.rs', type: 'commit_file', attributes: ['link']}], next: '?pagelen=100&page=2'});
    if (url.endsWith('page=2')) return Response.json({values: [{path: 'main.py', type: 'commit_file', size: 2}]});
    if (url === `${base}/src/${revision}/src/?pagelen=100`) return Response.json({values: [{path: 'src/main.rs', type: 'commit_file', size: 10}]});
    if (url.startsWith(`${base}/src/${revision}/`)) return new Response('x\n');
    throw Error('Unexpected URL ' + url);
  };
  await onMessage({data: {type: 'repository', url: 'https://bitbucket.org/acme/demo/src/other/'}});
  assert.equal(last().type, 'result', last().message);
  assert.equal(last().data.results.Total.files, 2);
  assert.equal(last().data.detail.revision, revision);
  assert.ok(!requests.some(url => /node_modules|link\.rs/.test(url)));
});

for (const [prefix, type] of [['', 'model'], ['datasets/', 'dataset'], ['spaces/', 'space']]) {
  test(`Hugging Face ${type} pins pagination and skips LFS/Xet assets without downloading weights`, async () => {
    const requests = [];
    route = async url => {
      requests.push(url);
      const base = `https://huggingface.co/api/${type}s/acme/demo`;
      if (url === base) return Response.json({sha: revision, gated: false, private: false});
      if (url.includes('/tree/')) return url.includes('cursor=next') ? Response.json([{path: 'config.json', type: 'file', size: 3}]) :
        Response.json([{path: 'app.py', type: 'file', size: 5}, {path: 'model.safetensors', type: 'file', size: 5e9, lfs: {size: 5e9}},
          {path: 'huge.json', type: 'file', size: 500e6, xetHash: 'blob'}], {headers: {Link: `<?cursor=next>; rel="next"`}});
      if (url.includes(`/raw/${revision}/`)) return new Response(url.endsWith('app.py') ? 'x = 1\n' : '{}\n');
      throw Error('Unexpected URL ' + url);
    };
    await onMessage({data: {type: 'repository', url: `https://huggingface.co/${prefix}acme/demo`}});
    assert.equal(last().type, 'result', last().message);
    assert.equal(last().data.results.Total.files, 2);
    assert.equal(last().data.detail.repoType, type);
    assert.equal(last().data.detail.revision, revision);
    assert.match(last().data.warnings.join(' '), /2 Git LFS\/Xet assets/);
    assert.ok(!requests.some(url => /model\.safetensors|huge\.json/.test(url)));
  });
}

test('gated Hugging Face repositories fail before listing or downloading files', async () => {
  route = async () => Response.json({sha: revision, gated: 'manual'});
  await onMessage({data: {type: 'repository', url: 'https://huggingface.co/acme/demo'}});
  assert.equal(last().type, 'error');
  assert.match(last().message, /private, gated, or disabled/);
});

test('SourceForge validates Git tools, pins HEAD and walks the code tree without executing page scripts', async () => {
  const requests = [];
  const root = `https://sourceforge.net/p/acme/code/ci/${revision}/tree/`;
  route = async url => {
    requests.push(url);
    if (url === 'https://sourceforge.net/rest/p/acme/code/') return Response.json({name: 'git'});
    if (url === 'https://git.code.sf.net/p/acme/code/info/refs?service=git-upload-pack') return new Response(refs);
    if (url.endsWith('?format=raw')) return new Response('fn main() {}\n');
    if (url === root) return new Response(sourceforgeHTML([['src', true], ['node_modules', true], ['main.py']]));
    if (url === root + 'src/') return new Response(sourceforgeHTML([['main.rs']]));
    throw Error('Unexpected URL ' + url);
  };
  await onMessage({data: {type: 'repository', url: 'https://sourceforge.net/p/acme/code/ci/other/tree/'}});
  assert.equal(last().type, 'result', last().message);
  assert.equal(last().data.results.Total.files, 2);
  assert.equal(last().data.detail.revision, revision);
  assert.ok(!requests.some(url => url.includes('node_modules')));
  route = async () => Response.json({name: 'svn'});
  await onMessage({data: {type: 'repository', url: 'https://sourceforge.net/p/acme/code'}});
  assert.match(last().message, /requires a Git code repository/);
});
