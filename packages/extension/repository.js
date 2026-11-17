// Only recognize repository pages, never GitHub's account or product pages.
const reservedOwners = new Set([
  'about', 'account', 'apps', 'business', 'codespaces', 'collections', 'contact', 'copilot',
  'customer-stories', 'dashboard', 'enterprise', 'enterprises', 'events', 'explore',
  'features', 'issues', 'join', 'login', 'logout', 'marketplace', 'new',
  'notifications', 'orgs', 'organizations', 'pricing', 'pulls', 'readme', 'resources', 'search',
  'security', 'sessions', 'settings', 'signup', 'site', 'solutions', 'sponsors', 'topics',
  'trending', 'users', 'watching',
]);
const repositoryPages = new Set([
  'actions', 'activity', 'blame', 'blob', 'branches', 'commit', 'commits', 'compare',
  'deployments', 'discussions', 'fork', 'forks', 'graphs', 'issues', 'labels',
  'milestones', 'network', 'packages', 'projects', 'pull', 'pulls', 'pulse', 'raw',
  'releases', 'security', 'settings', 'stargazers', 'tags', 'tree', 'watchers', 'wiki',
]);

export function repositoryFromURL(input) {
  let url;
  try {url = new URL(input);} catch {return null;}
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password) return null;
  const [owner, name, page] = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
  if (!owner || !name || reservedOwners.has(owner.toLowerCase())) return null;
  if (!/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(owner) || !/^[\w.-]+$/.test(name)) return null;
  const repo = name.replace(/\.git$/i, '');
  if (!repo || repo === '.' || repo === '..' || (page && !repositoryPages.has(page))) return null;
  return `${owner}/${repo}`;
}
