// A conservative browser-side exclusion list. Programming-language detection
// and ALL line parsing now belong to Rust `tokei` running in WebAssembly.
const ignoredSegments = new Set(['.git', 'node_modules', 'vendor', 'target', 'dist', 'build',
  '__pycache__', '.venv', 'venv', 'coverage', '.next', '.cache', '.idea', '.bundle']);
export function isExcluded(path) {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts.some((segment, i) => ignoredSegments.has(segment.toLowerCase()) ||
    (segment.startsWith('.') && i < parts.length - 1 && segment !== '.github'));
}
