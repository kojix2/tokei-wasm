import {restoreResult, setRepositoryHandler, runRepository, showError} from './app.js';
import {readResult, saveResult, recentResult} from './results.js';
import {knownProvider, parseRepository, repositoryFromURL} from './repositories.js';

const api = globalThis.browser || globalThis.chrome;
const isPopup = document.documentElement.dataset.extensionView === 'popup';
let saved = readResult();
let completed = null;
const providerSelect = document.querySelector('#repository-provider');
const params = new URLSearchParams(location.search);
if (providerSelect && ['gitlab', 'forgejo'].includes(params.get('provider'))) providerSelect.value = params.get('provider');
let servers = {};
try {servers = JSON.parse(localStorage.getItem('tokei:servers:v1')) || {};} catch {}

function showPopupMessage(text) {
  const message = document.querySelector('#popup-message');
  message.textContent = text;
  message.classList.toggle('hidden', !text);
}

async function startRepository(input, hint, userInitiated = false) {
  try {
    const repository = parseRepository(input, hint);
    if (!knownProvider(new URL(repository.origin).hostname)) {
      // Request only this server. This call runs directly from the Analyze click
      // so both browsers retain the user gesture required by permissions.request.
      const permission = {origins: [`${repository.origin}/*`]};
      const granted = userInitiated ? await api.permissions.request(permission) : await api.permissions.contains(permission);
      if (!granted) throw Error(`Access to this Git server was not granted. Click ${isPopup ? 'Refresh' : 'Analyze'} to try again.`);
      try {
        servers[repository.origin] = repository.provider;
        localStorage.setItem('tokei:servers:v1', JSON.stringify(servers));
      } catch {}
    }
    runRepository(repository.input, repository.provider);
  } catch (error) {showError(error.message);}
}
setRepositoryHandler(input => startRepository(input, providerSelect?.value || 'auto', true));

document.addEventListener('analysis-result', ({detail}) => {
  completed = detail;
  saved = saveResult(detail);
  if (isPopup) showPopupMessage(saved ? '' : 'Results could not be saved. Reopening will start a new analysis.');
});

if (isPopup) {
  const button = document.querySelector('#open-details');
  const refresh = document.querySelector('#refresh');
  let repository = null;
  let provider = 'auto';
  let serverURL = null;
  refresh.addEventListener('click', () => {
    if (!repository) return;
    showPopupMessage('');
    startRepository(repository, provider, true);
  });
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      // Save again so another view cannot replace the result before handoff.
      if (completed) saved = saveResult(completed);
      const busy = !document.querySelector('#progress-box').classList.contains('hidden');
      const url = new URL(api.runtime.getURL('index.html'));
      if (repository) url.searchParams.set('repo', repository);
      else if (serverURL) url.searchParams.set('configure', serverURL);
      if (!busy && completed && saved?.data === completed) url.searchParams.set('result', saved.id);
      if (provider !== 'auto') url.searchParams.set('provider', provider);
      await api.tabs.create({url: url.href});
      window.close();
    } catch {
      showPopupMessage('Could not open the detail tab. Please try again.');
      button.disabled = false;
    }
  });
  try {
    const [tab] = await api.tabs.query({active: true, currentWindow: true});
    const customProvider = tab?.url && servers[new URL(tab.url).origin];
    repository = repositoryFromURL(tab?.url, customProvider);
    if (repository && ['gitlab', 'forgejo'].includes(customProvider)) provider = customProvider;
    if (!repository) {
      const activeURL = tab?.url && new URL(tab.url);
      if (activeURL?.protocol === 'https:' && !knownProvider(activeURL.hostname) && activeURL.pathname.split('/').filter(Boolean).length >= 2) {
        serverURL = activeURL.href;
        showPopupMessage('Open details to configure this Git server.');
      } else showPopupMessage('Open a supported public repository to view its metrics.');
    } else if (recentResult(saved, repository)) {
      completed = saved.data;
      restoreResult(completed);
    } else await startRepository(repository, provider);
  } catch {
    showPopupMessage('Could not read the active tab. Reopen the popup to try again.');
  }
} else {
  if (params.get('result') && params.get('result') === saved?.id && saved.data.detail) {
    if (['gitlab', 'forgejo'].includes(saved.data.detail.provider)) providerSelect.value = saved.data.detail.provider;
    restoreResult(saved.data);
  } else if (params.get('configure')) {
    document.querySelector('#repo-url').value = params.get('configure');
    document.querySelector('.server-options').open = true;
  } else if (params.get('repo')) {
    // A custom server was granted access in the popup before opening this tab.
    document.querySelector('#repo-url').value = params.get('repo');
    await startRepository(params.get('repo'), providerSelect.value);
  }
}
