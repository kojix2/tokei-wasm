// Automatically updated from GitHub Linguist: https://github.com/ozh/github-colors
const colors = new Map();

export async function loadLanguageColors() {
  try {
    const response = await fetch('https://raw.githubusercontent.com/ozh/github-colors/master/colors.json', {signal: AbortSignal.timeout(3000)});
    if (!response.ok) return;
    for (const [name, entry] of Object.entries(await response.json())) {
      if (/^#[0-9a-f]{6}$/i.test(entry?.color)) colors.set(name.toLowerCase(), entry.color);
    }
  } catch { /* Colors are optional; analysis still works offline. */ }
}

// Tokei display names that differ from Linguist names and aliases.
const linguistNames = {
  'arduino c++': 'c++',
  'ark typescript': 'arkts',
  'automake': 'makefile',
  'axaml': 'xml',
  'c header': 'c',
  'c++ header': 'c++',
  'c++ module': 'c++',
  'c shell': 'shell',
  'clojurec': 'clojure',
  'clojurescript': 'clojure',
  'coldfusion cfscript': 'coldfusion cfc',
  '.net resource': 'xml',
  'dream maker': 'dm',
  'ebuild': 'gentoo ebuild',
  'edgedb schema definition': 'edgeql',
  'flatbuffers schema': 'flatbuffers',
  'fortran legacy': 'fortran',
  'fortran modern': 'fortran free form',
  'gherkin (cucumber)': 'gherkin',
  'gml': 'game maker language',
  'gnu style assembly': 'assembly',
  'go html': 'go template',
  'jinja2': 'jinja',
  'jsx': 'javascript',
  'tsx': 'typescript',
  'jupyter notebooks': 'jupyter notebook',
  'kakoune script': 'kakounescript',
  'korn shell': 'shell',
  'kv language': 'kvlang',
  'metal shading language': 'metal',
  'msbuild': 'xml',
  'nuget config': 'xml',
  "pacman's makepkg": 'shell',
  'rakefile': 'ruby',
  'ruby html': 'html+erb',
  'rusty object notation': 'ron',
  'scons': 'python',
  'standard ml (sml)': 'standard ml',
  'unreal plugin': 'json',
  'unreal project': 'json',
  'unreal script': 'unrealscript',
  'unreal shader': 'hlsl',
  'unreal shader header': 'hlsl',
  'ur/web project': 'urweb',
  'ur/web': 'urweb',
  'vb6/vba': 'visual basic 6.0',
  'apache velocity': 'velocity template language',
  'visual studio project': 'xml',
  'webgpu shader language': 'wgsl',
  'xaml': 'xml',
  'godot textscene': 'godot resource',
  'bash': 'shell',
};

export function languageColor(name) {
  const key = name.trim().toLowerCase();
  const language = Object.hasOwn(linguistNames, key) ? linguistNames[key] : key;
  return colors.get(language) || '#858585';
}
