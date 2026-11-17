import {restoreResult, setRepositoryHandler, runRepository, showError} from './app.js';
import {readResult, saveResult, recentResult} from './results.js';
import {knownProvider, parseRepository, repositoryFromURL} from './repositories.js';

const api = globalThis.browser || globalThis.chrome;
const isPopup = document.documentElement.dataset.extensionView === 'popup';
let saved = readResult();
let completed = null;
const providerSelect = document.querySelector('#repository-provider');
const params = new URLSearchParams(location.search);
if (['gitlab', 'forgejo'].includes(params.get('provider'))) providerSelect.value = params.get('provider');
let servers = {};
try {servers = JSON.parse(localStorage.getItem('tokei:servers:v1')) || {};} catch {}

async function startRepository(input, hint, userInitiated = false) {
  try {
    const repository = parseRepository(input, hint);
    if (!knownProvider(new URL(repository.origin).hostname)) {
      // Request only this server. This call runs directly from the Analyze click
      // so both browsers retain the user gesture required by permissions.request.
      const permission = {origins: [`${repository.origin}/*`]};
      const granted = userInitiated ? await api.permissions.request(permission) : await api.permissions.contains(permission);
      if (!granted) throw Error('Access to this Git server was not granted. Click Analyze to try again.');
      try {
        servers[repository.origin] = repository.provider;
        localStorage.setItem('tokei:servers:v1', JSON.stringify(servers));
      } catch {}
    }
    runRepository(repository.input, repository.provider);
  } catch (error) {showError(error.message);}
}
setRepositoryHandler(input => startRepository(input, providerSelect.value, true));

document.addEventListener('analysis-result', ({detail}) => {
  completed = detail;
  saved = saveResult(detail);
  if (isPopup && !saved) document.querySelector('footer').textContent = 'Results could not be saved on this device. Reopening will start a new analysis.';
});

if (isPopup) {
  const button = document.querySelector('#open-details');
  document.querySelector('.site-header h1 a').target = '_blank';
  const footer = document.querySelector('footer');
  footer.textContent = 'Keep this popup open while analyzing. Completed results are saved on this device.';
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      // Save again so another view cannot replace the result before handoff.
      if (completed) saved = saveResult(completed);
      const repo = document.querySelector('#repo-url').value.trim();
      const busy = !document.querySelector('#progress-box').classList.contains('hidden');
      const url = new URL(api.runtime.getURL('index.html'));
      if (repo) url.searchParams.set('repo', repo);
      if (!busy && saved?.data === completed) url.searchParams.set('result', saved.id);
      if (providerSelect.value !== 'auto') url.searchParams.set('provider', providerSelect.value);
      await api.tabs.create({url: url.href});
      window.close();
    } catch {
      footer.textContent = 'Could not open the detail tab. Please try again.';
      button.disabled = false;
    }
  });
  try {
    const [tab] = await api.tabs.query({active: true, currentWindow: true});
    const customProvider = tab?.url && servers[new URL(tab.url).origin];
    const repo = repositoryFromURL(tab?.url, customProvider);
    if (repo && ['gitlab', 'forgejo'].includes(customProvider)) providerSelect.value = customProvider;
    if (recentResult(saved, repo)) {
      completed = saved.data;
      restoreResult(completed);
    } else if (repo) {
      document.querySelector('#repo-url').value = repo;
      await startRepository(repo, providerSelect.value);
    }
  } catch {
    footer.textContent = 'Enter a public repository URL to analyze.';
  }
} else {
  if (params.get('result') && params.get('result') === saved?.id && saved.data.detail) {
    if (['gitlab', 'forgejo'].includes(saved.data.detail.provider)) providerSelect.value = saved.data.detail.provider;
    restoreResult(saved.data);
  } else if (params.get('repo')) {
    // A custom server was granted access in the popup before opening this tab.
    document.querySelector('#repo-url').value = params.get('repo');
    await startRepository(params.get('repo'), providerSelect.value);
  }
}
