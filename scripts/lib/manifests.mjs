import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const targets = ['chrome', 'firefox'];
export const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

export function createManifest(target, sourceRoot = root) {
  if (!targets.includes(target)) throw Error(`Unknown extension target: ${target}`);
  const manifest = JSON.parse(readFileSync(join(sourceRoot, 'apps', target, 'manifest.json'), 'utf8'));
  if (manifest.version !== version) throw Error(`${target} manifest version must match package.json (${version}).`);
  return manifest;
}
