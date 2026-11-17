import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseRepository, repositoryFileURL} from '../apps/web/repositories.js';
import {parseTar, readBounded, gitHead} from '../apps/web/archive.js';
import {tarArchive, tarEntry, pax, revision, refs, gitPacket} from './helpers/archive.mjs';
import {readResult, saveResult, recentResult} from '../packages/extension/results.js';
import {nextPage, sourceforgeEntries} from '../apps/web/hosts.js';
import {sourceforgeHTML} from './helpers/sourceforge.mjs';

test('repository URLs recognize each host, nested namespaces and repository subpages', () => {
  const cases = [
    ['acme/demo', 'github', 'acme/demo'],
    ['https://gitlab.com/team/subgroup/demo/-/blob/main/file.rs?plain=1#L1', 'gitlab', 'team/subgroup/demo'],
    ['https://codeberg.org/acme/demo/src/branch/main/src/main.rs', 'forgejo', 'acme/demo'],
    ['https://code.forgejo.org/acme/demo/issues/2', 'forgejo', 'acme/demo'],
    ['https://gitea.com/acme/demo', 'forgejo', 'acme/demo'],
    ['https://gitee.com/acme/demo/tree/main', 'gitee', 'acme/demo'],
    ['https://git.sr.ht/~alice/demo/tree/main/item/main.rs', 'sourcehut', '~alice/demo'],
    ['git@gitlab.com:team/subgroup/demo.git', 'gitlab', 'team/subgroup/demo'],
    ['https://bitbucket.org/acme/demo/pull-requests/42', 'bitbucket', 'acme/demo'],
    ['https://sourceforge.net/p/acme/code/ci/main/tree/src/main.rs', 'sourceforge', 'p/acme/code'],
    ['https://git.code.sf.net/p/acme/code', 'sourceforge', 'p/acme/code'],
    ['https://huggingface.co/acme/demo/blob/main/app.py', 'huggingface', 'acme/demo'],
    ['https://huggingface.co/spaces/acme/demo/tree/main', 'huggingface', 'acme/demo'],
    ['https://huggingface.co/datasets/acme/demo/discussions/1', 'huggingface', 'acme/demo'],
    ['https://hf.co/gpt2/tree/main', 'huggingface', 'gpt2'],
  ];
  for (const [input, provider, project] of cases) {
    const repo = parseRepository(input);
    assert.equal(repo.provider, provider, input);
    assert.equal(repo.project, project, input);
    assert.ok(!repo.url.includes('?'));
  }
  assert.equal(parseRepository('https://git.example.org/a/b', 'forgejo').provider, 'forgejo');
  assert.equal(parseRepository('https://git.example.org/a/team/b/-/issues', 'gitlab').project, 'a/team/b');
  assert.equal(parseRepository('https://huggingface.co/spaces/acme/demo').repoType, 'space');
  assert.equal(parseRepository('https://huggingface.co/datasets/acme/demo').repoType, 'dataset');
  assert.equal(parseRepository('https://hf.co/gpt2').url, 'https://huggingface.co/gpt2');
  assert.equal(parseRepository('https://git.code.sf.net/p/acme/code').url, 'https://sourceforge.net/p/acme/code');
});

test('unknown hosts require an explicit server type and invalid URLs are rejected', () => {
  for (const input of ['https://github.com.evil.test/acme/demo', 'https://example.com/acme/demo',
    'http://codeberg.org/acme/demo', 'https://user:password@gitlab.com/acme/demo',
    'https://gitee.com/acme/demo%2Fother', 'https://git.sr.ht/alice/demo',
    'https://gitlab.com/groups', 'https://codeberg.org/explore/repos', 'https://github.com/acme/demo/unknown',
    'https://codeberg.org:8443/acme/demo', 'https://huggingface.co/models', 'https://huggingface.co/docs/hub',
    'https://huggingface.co/spaces', 'https://sourceforge.net/projects/acme/files/',
    'https://sourceforge.net/p/acme/code/admin/']) assert.throws(() => parseRepository(input), undefined, input);
});

test('file links point to each host at a pinned revision and encode filenames safely', () => {
  const cases = [
    ['https://github.com/acme/demo', `/blob/${revision}/a%20b/%23.rs`],
    ['https://gitlab.com/team/sub/demo', `/-/blob/${revision}/a%20b/%23.rs`],
    ['https://codeberg.org/acme/demo', `/src/commit/${revision}/a%20b/%23.rs`],
    ['https://gitee.com/acme/demo', `/blob/${revision}/a%20b/%23.rs`],
    ['https://git.sr.ht/~alice/demo', `/tree/${revision}/item/a%20b/%23.rs`],
    ['https://bitbucket.org/acme/demo', `/src/${revision}/a%20b/%23.rs`],
    ['https://sourceforge.net/p/acme/code', `/ci/${revision}/tree/a%20b/%23.rs`],
    ['https://huggingface.co/spaces/acme/demo', `/blob/${revision}/a%20b/%23.rs`],
  ];
  for (const [url, suffix] of cases) assert.equal(repositoryFileURL({...parseRepository(url), revision}, 'a b/#.rs'), url + suffix);
});

test('pagination remains on the same host and commit listing and handles relative cursors', () => {
  const base = `https://huggingface.co/api/models/acme/demo/tree/${revision}?recursive=true`;
  assert.equal(nextPage('?cursor=next', base), new URL('?cursor=next', base).href);
  assert.equal(nextPage(null, base), null);
  for (const url of ['https://evil.test/cursor', '/api/models/acme/other/tree/main', 'http://huggingface.co/api/models/acme/demo/tree/' + revision,
    `https://user:secret@huggingface.co/api/models/acme/demo/tree/${revision}`]) assert.throws(() => nextPage(url, base), /invalid pagination/);
});

test('SourceForge reads only the Allura code table and keeps paths within the pinned tree', () => {
  const root = `https://sourceforge.net/p/acme/code/ci/${revision}/tree/`;
  const page = sourceforgeHTML([['src', true], ['a%20b.py'], ['https://evil.test/steal.rs'], ['../escape.rs']]) +
    '<div><a class="icon" href="fake.rs"><i class="fa fa-file-o"></i>not a code row</a></div>';
  assert.deepEqual(sourceforgeEntries(page, root, root).map(e => [e.path, e.type]), [['src', 'tree'], ['a b.py', 'blob']]);
  assert.deepEqual(sourceforgeEntries(sourceforgeHTML([['main.rs']]), root + 'src/', root).map(e => e.path), ['src/main.rs']);
  assert.throws(() => sourceforgeEntries('<html>Checking you are not a bot</html>', root, root), /readable code tree/);
});

test('cached results never cross hosts or case-sensitive repository paths', () => {
  let value;
  const storage = {getItem: () => value, setItem: (_, data) => {value = data;}};
  const now = Date.now();
  const data = {detail: parseRepository('https://codeberg.org/acme/Demo'), results: {Total: {}}, warnings: [], analyzedAt: new Date(now).toISOString()};
  saveResult(data, storage);
  const record = readResult(storage);
  assert.ok(recentResult(record, 'https://codeberg.org/acme/Demo', now));
  assert.ok(!recentResult(record, 'https://codeberg.org/acme/demo', now));
  assert.ok(!recentResult(record, 'https://gitee.com/acme/Demo', now));
  assert.ok(!recentResult({...record, data: {...data, detail: null}}, null, now));
});

test('sourcehut tar reader preserves paths and pinned commits while excluding links', () => {
  const result = parseTar(tarArchive({'src/main.rs': 'fn main() {}\n'}, [tarEntry('demo/link.rs', 'target', '2')]));
  assert.equal(result.revision, revision);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].path, 'src/main.rs');
  assert.equal(new TextDecoder().decode(result.entries[0].bytes), 'fn main() {}\n');
  const longPath = `demo/${'日本語'.repeat(30)}.rs`;
  const extended = parseTar(tarArchive({}, [tarEntry('pax', pax('path', longPath), 'x'), tarEntry('short', 'x\n')]));
  assert.equal(extended.entries[0].path, longPath.slice(5));
});

test('archive corruption, unsafe paths, expansion limits and cancellation produce errors', async () => {
  assert.throws(() => parseTar(tarArchive({}, [tarEntry('../escape.rs', 'x')])), /Invalid archive path/);
  const corrupted = tarArchive(); corrupted[0] ^= 1;
  assert.throws(() => parseTar(corrupted), /Invalid or incomplete/);
  assert.throws(() => parseTar(tarEntry('main.rs', 'x')), /commit ID/);
  await assert.rejects(readBounded(new Blob(['12345']).stream(), 4, 'Test stream'), /exceeds/);
  const control = new AbortController(); control.abort();
  await assert.rejects(readBounded(new Blob(['12345']).stream(), 40, 'Test stream', control.signal), {name: 'AbortError'});
});

test('Git discovery separates packet lengths from SHA-1 and SHA-256 commit IDs', () => {
  assert.deepEqual(gitHead(new TextEncoder().encode(refs)), {revision, ref: 'main'});
  const sha256 = 'b'.repeat(64);
  assert.deepEqual(gitHead(new TextEncoder().encode(gitPacket(`${sha256} HEAD\0symref=HEAD:refs/heads/feature/test\n`))),
    {revision: sha256, ref: 'feature/test'});
  assert.throws(() => gitHead(new TextEncoder().encode('ffffx')), /Incomplete/);
  assert.throws(() => gitHead(new TextEncoder().encode('0000')), /empty/);
});
