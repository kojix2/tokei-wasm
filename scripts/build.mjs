import {copyFile, mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createManifest, root, targets as extensionTargets, version} from './lib/manifests.mjs';

const allTargets = ['web', ...extensionTargets];
const appFiles = [
  'index.html', 'app.js', 'worker.js', 'languages.js', 'language-colors.js', 'style.css',
  'favicon-16x16.png', 'favicon-32x32.png',
  'third-party/tokei-MIT.txt', 'third-party/tokei-Apache-2.0.txt',
  'third-party/home-MIT.txt', 'third-party/home-Apache-2.0.txt',
];

export async function buildApplications({sourceRoot = root, outDir = join(root, 'dist'), targets = allTargets, packageZip = false} = {}) {
  for (const target of targets) if (!allTargets.includes(target)) throw Error(`Unknown app target: ${target}`);
  const runtimeFiles = [
    ...appFiles.map(file => [join(sourceRoot, 'apps/web', file), file]),
    ...['tokei_wasm.js', 'tokei_wasm_bg.wasm'].map(file => [join(sourceRoot, 'packages/wasm/pkg', file), `pkg/${file}`]),
    [join(sourceRoot, 'LICENSE'), 'LICENSE'],
  ];
  const builds = targets.map(target => ({
    target,
    manifest: target === 'web' ? null : createManifest(target, sourceRoot),
    files: [...runtimeFiles, ...(target === 'web' ? [[join(sourceRoot, 'apps/web/.nojekyll'), '.nojekyll']] :
      ['background.js', 'action.js', 'repository.js'].map(file => [join(sourceRoot, 'packages/extension', file), file]))],
  }));
  // Validate all inputs before replacing any previous app output.
  for (const source of new Set(builds.flatMap(build => build.files.map(([source]) => source)))) {
    try {
      const info = await stat(source);
      if (!info.isFile() || (!info.size && !source.endsWith('/.nojekyll'))) throw Error('empty or not a file');
    } catch (error) {
      throw Error(`Missing or empty build input: ${source}. For missing Wasm artifacts, run npm run build:wasm first.`, {cause: error});
    }
  }
  const wasm = await readFile(join(sourceRoot, 'packages/wasm/pkg/tokei_wasm_bg.wasm'));
  if (!WebAssembly.validate(wasm)) throw Error('The bundled tokei WebAssembly is invalid. Run npm run build:wasm first.');
  const outputs = [];
  for (const {target, files, manifest} of builds) {
    const directory = join(outDir, target);
    await rm(directory, {recursive: true, force: true});
    await mkdir(directory, {recursive: true});
    for (const [source, destination] of files) {
      const path = join(directory, destination);
      await mkdir(resolve(path, '..'), {recursive: true});
      await copyFile(source, path);
    }
    if (manifest) await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    outputs.push(directory);
    if (packageZip && extensionTargets.includes(target)) {
      const archive = resolve(outDir, `tokei-wasm-${target}-${version}.zip`);
      await rm(archive, {force: true});
      const zipped = spawnSync('zip', ['-q', '-X', '-r', archive, '.'], {cwd: directory, encoding: 'utf8'});
      if (zipped.error || zipped.status !== 0) throw Error(`Could not create ${archive}. Install the zip command. ${zipped.error?.message || zipped.stderr}`);
      outputs.push(archive);
    }
  }
  return outputs;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const targets = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
    const outputs = await buildApplications({...(targets.length ? {targets} : {}), packageZip: process.argv.includes('--zip')});
    for (const output of outputs) console.log(output);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
