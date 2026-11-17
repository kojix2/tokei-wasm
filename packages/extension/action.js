import {repositoryFromURL} from './repository.js';

export async function openAnalyzer(api, tab) {
  const url = new URL(api.runtime.getURL('index.html'));
  const repo = repositoryFromURL(tab?.url);
  if (repo) url.searchParams.set('repo', repo);
  try {
    await api.tabs.create({url: url.href});
  } catch (error) {
    console.error('Could not open the tokei analysis tab:', error);
  }
}

export function registerAction(api) {
  api.action.onClicked.addListener(tab => openAnalyzer(api, tab));
}
