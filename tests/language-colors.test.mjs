import assert from 'node:assert/strict';
import {test} from 'node:test';
import {languageColor, loadLanguageColors} from '../docs/language-colors.js';

test('color loading tolerates offline, HTTP, and invalid JSON failures', async t => {
  for (const result of [new Error('offline'), new Response('', {status: 503}), new Response('invalid JSON')]) {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
      if (result instanceof Error) throw result;
      return result;
    });
    await loadLanguageColors();
    assert.equal(languageColor('Rust'), '#858585');
    fetchMock.mock.restore();
  }
});

test('fetched colors support tokei names, variants, and missing colors', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    Rust: {color: '#dea584'}, Python: {color: '#3572A5'}, 'C++': {color: '#f34b7d'},
    JavaScript: {color: '#f1e05a'}, TypeScript: {color: '#3178c6'}, Shell: {color: '#89e051'},
    Assembly: {color: '#6E4C13'}, 'Jupyter Notebook': {color: '#DA5B0B'},
    Text: {color: null}, Invalid: {color: 'not a color'},
  }));
  await loadLanguageColors();
  assert.equal(languageColor('Rust'), '#dea584');
  assert.equal(languageColor('  PYTHON  '), '#3572A5');
  assert.equal(languageColor('C++ Header'), '#f34b7d');
  assert.equal(languageColor('JSX'), '#f1e05a');
  assert.equal(languageColor('TSX'), '#3178c6');
  assert.equal(languageColor('BASH'), '#89e051');
  assert.equal(languageColor('GNU Style Assembly'), '#6E4C13');
  assert.equal(languageColor('Jupyter Notebooks'), '#DA5B0B');
  for (const name of ['Unknown language', 'Text', 'Invalid', 'constructor', '__proto__']) {
    assert.equal(languageColor(name), '#858585', name);
  }
});
