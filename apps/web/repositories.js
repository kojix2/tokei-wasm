const knownHosts = {
  'github.com': 'github', 'gitlab.com': 'gitlab', 'codeberg.org': 'forgejo',
  'code.forgejo.org': 'forgejo', 'gitea.com': 'forgejo', 'gitee.com': 'gitee', 'git.sr.ht': 'sourcehut',
  'bitbucket.org': 'bitbucket', 'sourceforge.net': 'sourceforge', 'git.code.sf.net': 'sourceforge',
  'huggingface.co': 'huggingface', 'hf.co': 'huggingface',
};
const reserved = new Set(['about', 'account', 'apps', 'business', 'codespaces', 'collections', 'contact', 'copilot',
  'customer-stories', 'dashboard', 'enterprise', 'enterprises', 'events', 'explore', 'features', 'issues', 'join',
  'login', 'logout', 'marketplace', 'new', 'notifications', 'orgs', 'organizations', 'pricing', 'pulls', 'readme',
  'resources', 'search', 'security', 'sessions', 'settings', 'signup', 'site', 'solutions', 'sponsors', 'topics',
  'trending', 'users', 'watching', 'help', 'admin', 'assets', 'api']);
const pages = new Set(['actions', 'activity', 'blame', 'blob', 'branches', 'commit', 'commits', 'compare',
  'deployments', 'discussions', 'fork', 'forks', 'graphs', 'issues', 'labels', 'milestones', 'network', 'packages',
  'projects', 'pull', 'pulls', 'pulse', 'raw', 'releases', 'security', 'settings', 'src', 'stargazers', 'tags',
  'tree', 'watchers', 'wiki', 'log', 'refs', 'summary', 'pull-requests', 'pipelines', 'downloads']);
const encodePath = path => path.split('/').map(encodeURIComponent).join('/');

export function knownProvider(hostname) {return Object.hasOwn(knownHosts, hostname) ? knownHosts[hostname] : null;}

export function parseRepository(input, providerHint = 'auto') {
  let value = String(input || '').trim();
  const ssh = value.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (ssh) value = `https://${ssh[1]}/${ssh[2]}`;
  if (/^[\w.-]+\/[\w.-]+$/.test(value)) value = `https://github.com/${value}`;
  let url;
  try {url = new URL(value);} catch {throw Error('Enter a public repository URL or GitHub owner/repository.');}
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw Error('Use an HTTPS repository URL without credentials or a custom port.');
  const provider = knownProvider(url.hostname) || (['gitlab', 'forgejo'].includes(providerHint) ? providerHint : null);
  if (!provider) throw Error('For another Git server, choose GitLab or Forgejo / Gitea under Other Git servers.');
  const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/').map(part => {
    try {return decodeURIComponent(part);} catch {throw Error('Invalid repository URL.');}
  });
  if (parts.some(part => !part || part === '.' || part === '..' || /[\\/\x00-\x20?#]/.test(part))) throw Error('Invalid repository path.');
  let project, repoType;
  if (provider === 'huggingface') {
    url.hostname = 'huggingface.co';
    repoType = parts[0] === 'datasets' ? 'dataset' : parts[0] === 'spaces' ? 'space' : 'model';
    const offset = repoType === 'model' ? 0 : 1;
    const names = parts.slice(offset);
    const count = names.length === 1 || pages.has(names[1]) || ['resolve', 'discussions'].includes(names[1]) ? 1 : 2;
    if (!names[0] || reserved.has(names[0].toLowerCase()) || ['models', 'datasets', 'spaces', 'docs', 'collections', 'organizations', 'settings'].includes(names[0]) ||
        names.slice(0, count).some(name => !/^[\w.-]+$/.test(name)) ||
        (names[count] && !pages.has(names[count]) && !['resolve', 'discussions'].includes(names[count]))) throw Error('Open a Hugging Face model, dataset, or Space repository.');
    project = names.slice(0, count).join('/');
  } else if (provider === 'sourceforge') {
    url.hostname = 'sourceforge.net';
    if (!['p', 'u'].includes(parts[0]) || parts.length < 3 || parts.slice(1, 3).some(name => !/^[\w.-]+$/.test(name)) ||
        (parts[3] && !['ci', 'ref', 'log', 'commit_browser', 'tree'].includes(parts[3]))) throw Error('Open a SourceForge Git code page: https://sourceforge.net/p/PROJECT/REPOSITORY/');
    project = parts.slice(0, 3).join('/');
  } else if (provider === 'gitlab') {
    const separator = parts.indexOf('-');
    project = (separator < 0 ? parts : parts.slice(0, separator)).join('/');
    if (project.split('/').length < 2 || reserved.has(parts[0].toLowerCase())) throw Error('Open a GitLab project, including its namespace.');
  } else {
    if (parts.length < 2 || (parts[2] && !pages.has(parts[2])) || reserved.has(parts[0].toLowerCase())) throw Error('Open a repository page.');
    if (provider === 'sourcehut' && !/^~[\w.-]+$/.test(parts[0])) throw Error('Use a sourcehut URL such as https://git.sr.ht/~user/repository.');
    if (provider === 'github' && !/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(parts[0])) throw Error('Invalid repository owner.');
    if (provider !== 'sourcehut' && !/^[\w.-]+$/.test(parts[0])) throw Error('Invalid repository owner.');
    if (!/^[\w.-]+$/.test(parts[1])) throw Error('Invalid repository name.');
    project = parts.slice(0, 2).join('/');
  }
  project = project.replace(/\.git$/i, '');
  const segments = project.split('/');
  const repo = segments.pop();
  if (!repo || repo === '.' || repo === '..') throw Error('Invalid repository name.');
  const owner = segments.join('/');
  const typePrefix = repoType === 'dataset' ? 'datasets/' : repoType === 'space' ? 'spaces/' : '';
  const repositoryURL = `${url.origin}/${typePrefix}${encodePath(project)}`;
  return {provider, origin: url.origin, owner, repo, project, url: repositoryURL,
    ...(repoType ? {repoType} : {}), input: provider === 'github' ? project : repositoryURL};
}

export function repositoryFileURL(detail, filename) {
  const provider = detail.provider || 'github';
  const root = detail.url || `https://github.com/${encodePath(`${detail.owner}/${detail.repo}`)}`;
  const revision = encodeURIComponent(detail.revision || detail.ref);
  const path = encodePath(filename);
  if (provider === 'gitlab') return `${root}/-/blob/${revision}/${path}`;
  if (provider === 'forgejo') return `${root}/src/commit/${revision}/${path}`;
  if (provider === 'sourcehut') return `${root}/tree/${revision}/item/${path}`;
  if (provider === 'bitbucket') return `${root}/src/${revision}/${path}`;
  if (provider === 'sourceforge') return `${root}/ci/${revision}/tree/${path}`;
  return `${root}/blob/${revision}/${path}`;
}

// Toolbar input is an absolute page URL; typed input can also be owner/repo.
export function repositoryFromURL(input, providerHint = 'auto') {
  try {new URL(input); return parseRepository(input, providerHint).input;} catch {return null;}
}
