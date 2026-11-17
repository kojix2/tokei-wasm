import {sourcehutArchive, gitHead, readBounded} from './archive.js';
import {isExcluded} from './exclude.js';
const enc = encodeURIComponent;
const path = value => value.split('/').map(enc).join('/');
const MAX_TREE_ENTRIES = 100_000;

export async function request(url, signal, accept = 'application/json') {
  const response = await fetch(url, {signal, credentials: 'omit', headers: {Accept: accept}});
  if (!response.ok) {
    if (response.status === 401 || response.status === 404) throw Error('Repository not found or private. Only public repositories are supported.');
    if (response.status === 403 || response.status === 429) throw Error('Repository access was denied or the API rate limit was reached. Try again later.');
    if (response.status === 409) throw Error('This repository is empty. Choose a repository with source files.');
    if (response.status === 418) throw Error(`${new URL(url).hostname} requires a browser check and blocked this download. Analysis is unavailable while the host blocks automated requests.`);
    throw Error(`Repository host returned HTTP ${response.status}.`);
  }
  return response;
}
async function jsonResponse(url, signal) {
  const response = await request(url, signal);
  try {return {response, data: await response.json()};}
  catch {throw Error(`${new URL(url).hostname} did not return a public API response. The host may require a login or browser check.`);}
}

export async function repositoryTree(repository, signal, warnings, progress) {
  const {provider, origin, project} = repository;
  let ref, revision, rawURL;
  let entries = [];
  if (provider === 'huggingface') {
    const type = {model: 'models', dataset: 'datasets', space: 'spaces'}[repository.repoType];
    const base = `${repository.origin}/api/${type}/${path(repository.project)}`;
    const {data: info} = await jsonResponse(base, signal);
    if (info.private || info.gated || info.disabled) throw Error('This Hugging Face repository is private, gated, or disabled. Only unrestricted public repositories are supported.');
    ref = 'main'; revision = info.sha;
    if (!revision) throw Error('The repository did not return a commit ID.');
    let url = `${base}/tree/${enc(revision)}?recursive=true&limit=100`;
    let assets = 0;
    const visited = new Set();
    while (url) {
      if (visited.has(url)) throw Error('The host repeated a pagination cursor.');
      visited.add(url);
      progress('Reading Hugging Face repository files…');
      const {data, response} = await jsonResponse(url, signal);
      if (!Array.isArray(data)) throw Error('Invalid Hugging Face file list.');
      for (const item of data) {
        if (item.lfs || item.xetHash) {assets++; continue;}
        entries.push({path: item.path, type: item.type === 'file' ? 'blob' : 'tree', size: item.size, mode: '100644'});
      }
      if (entries.length + assets >= MAX_TREE_ENTRIES) {warnings.push('Repository tree limit reached; results are incomplete.'); break;}
      url = linkNext(response, url);
    }
    if (assets) warnings.push(`${assets} Git LFS/Xet assets (such as model weights or dataset files) excluded without downloading them.`);
    rawURL = entry => `${repository.url}/raw/${enc(revision)}/${path(entry.path)}`;
  } else if (provider === 'bitbucket') {
    const base = `https://api.bitbucket.org/2.0/repositories/${path(repository.project)}`;
    const {data: info} = await jsonResponse(base, signal);
    if (info.scm && info.scm !== 'git') throw Error('Only Git repositories are supported on Bitbucket Cloud.');
    ref = info.mainbranch?.name;
    if (!ref) throw Error('This repository is empty or has no default branch.');
    const {data: branch} = await jsonResponse(`${base}/refs/branches/${enc(ref)}`, signal);
    revision = branch.target?.hash;
    if (!revision) throw Error('The repository did not return a commit ID.');
    const directories = [''];
    const seenDirectories = new Set(['']);
    let count = 0;
    for (let index = 0; index < directories.length; index++) {
      const directory = directories[index];
      let url = `${base}/src/${enc(revision)}/${path(directory)}?pagelen=100`;
      const visited = new Set();
      while (url) {
        if (visited.has(url)) throw Error('The host repeated a pagination cursor.');
        visited.add(url);
        progress(`Reading Bitbucket directories (${index + 1} / ${directories.length})…`);
        const {data} = await jsonResponse(url, signal);
        if (!Array.isArray(data.values)) throw Error('Invalid Bitbucket file list.');
        for (const item of data.values) {
          count++;
          if (item.type === 'commit_directory' && !isExcluded(`${item.path}/_`)) {
            const name = item.path + '/';
            if (!seenDirectories.has(name)) {seenDirectories.add(name); directories.push(name);}
          } else if (item.type === 'commit_file' && !item.attributes?.some(value => ['link', 'subrepository'].includes(value))) {
            entries.push({path: item.path, type: 'blob', size: item.size, mode: '100644'});
          }
        }
        if (count >= MAX_TREE_ENTRIES) {warnings.push('Repository tree limit reached; results are incomplete.'); break;}
        url = nextPage(data.next, url);
      }
      if (count >= MAX_TREE_ENTRIES) break;
    }
    rawURL = entry => `${base}/src/${enc(revision)}/${path(entry.path)}`;
  } else if (provider === 'sourceforge') {
    ({entries, ref, revision, rawURL} = await sourceforgeTree(repository, signal, warnings, progress));
  } else if (provider === 'sourcehut') {
    progress('Downloading sourcehut repository archive…');
    const archive = await sourcehutArchive(repository, signal, request);
    ref = archive.ref; revision = archive.revision; entries = archive.entries;
  } else if (provider === 'gitlab') {
    const base = `${origin}/api/v4/projects/${enc(project)}`;
    const {data: info} = await jsonResponse(base, signal);
    ref = info.default_branch;
    if (!ref) throw Error('This repository is empty.');
    revision = (await jsonResponse(`${base}/repository/commits/${enc(ref)}`, signal)).data.id;
    // Page until an empty page, independently of CORS-exposed pagination headers.
    for (let page = 1; ; page++) {
      progress(`Reading repository file list (page ${page})…`);
      const {data: batch} = await jsonResponse(`${base}/repository/tree?ref=${enc(revision)}&recursive=true&per_page=100&page=${page}`, signal);
      if (!Array.isArray(batch)) throw Error('Invalid GitLab file list.');
      if (!batch.length) break;
      entries.push(...batch);
      if (entries.length >= MAX_TREE_ENTRIES) {warnings.push('Repository tree limit reached; results are incomplete.'); break;}
    }
    rawURL = entry => `${base}/repository/blobs/${enc(entry.id)}/raw`;
  } else {
    const base = provider === 'github' ? `https://api.github.com/repos/${path(project)}` :
      `${origin}/api/${provider === 'gitee' ? 'v5' : 'v1'}/repos/${path(project)}`;
    const {data: info} = await jsonResponse(base, signal);
    ref = info.default_branch;
    if (!ref) throw Error('This repository is empty.');
    const {data: commit} = await jsonResponse(`${base}/${provider === 'forgejo' ? 'git/commits' : 'commits'}/${enc(ref)}`, signal);
    revision = commit.sha;
    const treeID = provider === 'github' ? commit.commit.tree.sha : revision;
    for (let page = 1; ; page++) {
      const suffix = provider === 'forgejo' ? `recursive=true&per_page=1000&page=${page}` : 'recursive=1';
      const {data: tree} = await jsonResponse(`${base}/git/trees/${enc(treeID)}?${suffix}`, signal);
      if (!Array.isArray(tree.tree)) throw Error('Invalid repository file list.');
      entries.push(...tree.tree);
      if (provider !== 'forgejo') {
        if (tree.truncated) warnings.push(`${provider === 'github' ? 'GitHub' : 'Gitee'} truncated the recursive tree; results are incomplete.`);
        break;
      }
      if (entries.length >= MAX_TREE_ENTRIES) {warnings.push('Repository tree limit reached; results are incomplete.'); break;}
      if (!tree.tree.length || (Number.isFinite(tree.total_count) ? entries.length >= tree.total_count : !tree.truncated)) break;
    }
    rawURL = provider === 'github' ? entry => `https://raw.githubusercontent.com/${path(project)}/${enc(revision)}/${path(entry.path)}` :
      provider === 'gitee' ? entry => `${repository.url}/raw/${enc(revision)}/${path(entry.path)}` :
      entry => `${base}/raw/${path(entry.path)}?ref=${enc(revision)}`;
  }
  if (!revision || typeof revision !== 'string') throw Error('The repository did not return a commit ID.');
  return {entries, rawURL, detail: {...repository, ref, revision}};
}

// Pagination must stay on the same immutable listing endpoint, even when a
// host returns an absolute cursor URL. Do not follow arbitrary API-supplied URLs.
export function nextPage(value, current) {
  if (!value) return null;
  const next = new URL(value, current);
  const expected = new URL(current);
  if (next.origin !== expected.origin || next.pathname !== expected.pathname || next.username || next.password) throw Error('The host returned an invalid pagination URL.');
  return next.href;
}
function linkNext(response, current) {
  const next = response.headers.get('Link')?.match(/<([^>]+)>\s*;\s*rel\s*=\s*"?next"?/i)?.[1];
  return nextPage(next, current);
}
function unescapeHTML(value) {
  const named = {amp: '&', quot: '"', apos: "'", lt: '<', gt: '>'};
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (match, name) => {
    if (name[0] !== '#') return named[name.toLowerCase()];
    const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

export function sourceforgeEntries(html, directoryURL, treeRoot) {
  // Allura exposes commits via REST, but its tree browser is HTML. Read only
  // the actual File/Date/Author/Commit table; never execute remote page scripts.
  const table = Array.from(html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi))
    .find(([, content]) => /<th>\s*File\s*<\/th>/i.test(content) && /<th>\s*Commit\s*<\/th>/i.test(content))?.[1];
  if (!table) throw Error('SourceForge did not return a readable code tree. A browser check or changed page layout may prevent analysis.');
  const root = new URL(treeRoot);
  const current = new URL(directoryURL);
  const entries = [];
  for (const [, attributes, content] of table.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const folder = /\bfa-folder\b/.test(content);
    if (!folder && !/\bfa-file-o\b/.test(content)) continue;
    const href = attributes.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2];
    if (!href) continue;
    const url = new URL(unescapeHTML(href), current);
    if (url.origin !== root.origin || !url.pathname.startsWith(current.pathname) || url.username || url.password) continue;
    const child = url.pathname.slice(current.pathname.length).replace(/\/$/, '');
    if (!child || child.includes('/')) continue;
    const filePath = url.pathname.slice(root.pathname.length).replace(/\/$/, '').split('/').map(decodeURIComponent).join('/');
    if (filePath.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\\'))) throw Error('Invalid SourceForge file path.');
    entries.push({path: filePath, type: folder ? 'tree' : 'blob', mode: '100644'});
  }
  return entries;
}

async function sourceforgeTree(repository, signal, warnings, progress) {
  const metadataURL = `${repository.origin}/rest/${path(repository.project)}/`;
  const {data: info} = await jsonResponse(metadataURL, signal);
  if (info.name !== 'git') throw Error('SourceForge support requires a Git code repository. SVN, Mercurial, and release downloads are not supported.');
  const response = await request(`https://git.code.sf.net/${path(repository.project)}/info/refs?service=git-upload-pack`, signal, 'application/x-git-upload-pack-advertisement');
  const {ref, revision} = gitHead(await readBounded(response.body, 1_000_000, 'Git references', signal));
  const root = `${repository.url}/ci/${enc(revision)}/tree/`;
  const directories = [''];
  const seen = new Set(['']);
  const entries = [];
  let count = 0;
  for (let index = 0; index < directories.length; index++) {
    progress(`Reading SourceForge directories (${index + 1} / ${directories.length})…`);
    const url = root + path(directories[index]);
    const page = await request(url, signal, 'text/html');
    const html = new TextDecoder().decode(await readBounded(page.body, 4_000_000, 'SourceForge tree page', signal));
    for (const entry of sourceforgeEntries(html, url, root)) {
      count++;
      if (entry.type === 'tree' && !isExcluded(`${entry.path}/_`) && !seen.has(entry.path)) {
        seen.add(entry.path); directories.push(entry.path + '/');
      } else if (entry.type === 'blob') entries.push(entry);
    }
    if (count >= MAX_TREE_ENTRIES) {warnings.push('Repository tree limit reached; results are incomplete.'); break;}
  }
  return {entries, ref, revision, rawURL: entry => `${root}${path(entry.path)}?format=raw`};
}
