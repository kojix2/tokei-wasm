// Sourcehut's public archive endpoint avoids requiring a GraphQL access token.
// Bound both download and expansion; only regular files are passed to tokei.
export async function readBounded(stream, limit, label, signal) {
  if (!stream) throw Error(`Empty ${label} response.`);
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  const abort = () => {reader.cancel().catch(() => {});};
  signal?.addEventListener('abort', abort, {once: true});
  try {
    for (;;) {
      signal?.throwIfAborted();
      const {done, value} = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {await reader.cancel(); throw Error(`${label} exceeds the ${limit / 1e6} MB limit.`);}
      chunks.push(value);
    }
    signal?.throwIfAborted();
  } finally {signal?.removeEventListener('abort', abort); reader.releaseLock();}
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {data.set(chunk, offset); offset += chunk.length;}
  return data;
}

function paxFields(data) {
  const fields = {};
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(32, offset);
    if (space < 0) throw Error('Invalid archive PAX header.');
    const size = Number(decoder.decode(data.subarray(offset, space)));
    if (!Number.isSafeInteger(size) || size <= space - offset + 1 || offset + size > data.length) throw Error('Invalid archive PAX record.');
    const record = decoder.decode(data.subarray(space + 1, offset + size - 1));
    const equal = record.indexOf('=');
    if (equal > 0) fields[record.slice(0, equal)] = record.slice(equal + 1);
    offset += size;
  }
  return fields;
}

export function parseTar(data) {
  const decoder = new TextDecoder();
  const text = bytes => decoder.decode(bytes).replace(/\0.*$/s, '');
  const entries = [];
  let offset = 0, revision = null, nextPath = null;
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const sizeText = text(header.subarray(124, 136)).trim();
    if (!/^[0-7]+$/.test(sizeText)) throw Error('Invalid archive file size.');
    const size = parseInt(sizeText, 8);
    const checksum = parseInt(text(header.subarray(148, 156)).trim(), 8);
    const sum = header.reduce((total, byte, index) => total + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (sum !== checksum || !Number.isSafeInteger(size) || offset + 512 + size > data.length) throw Error('Invalid or incomplete archive.');
    const content = data.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    const type = header[156];
    if (type === 103 || type === 120) {
      const fields = paxFields(content);
      if (/^[a-f0-9]{40,64}$/.test(fields.comment || '')) revision = fields.comment;
      if (type === 120) nextPath = fields.path || null;
      continue;
    }
    if (type === 76) {nextPath = text(content); continue;}
    const prefix = text(header.subarray(345, 500));
    const path = nextPath || [prefix, text(header.subarray(0, 100))].filter(Boolean).join('/');
    nextPath = null;
    if (![0, 48].includes(type)) continue;
    if (path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..' || part.includes('\\'))) throw Error('Invalid archive path.');
    entries.push({path, type: 'blob', mode: '100644', size, bytes: content});
    if (entries.length > 100_000) throw Error('Archive contains too many files.');
  }
  // git archive supplies a top-level repository directory on sourcehut.
  const prefix = entries[0]?.path.split('/')[0] + '/';
  if (entries.length && entries.every(entry => entry.path.startsWith(prefix))) {
    for (const entry of entries) entry.path = entry.path.slice(prefix.length);
  }
  if (!revision) throw Error('The sourcehut archive did not include its Git commit ID.');
  return {entries, revision};
}

export function gitHead(data) {
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset + 4 <= data.length) {
    const prefix = decoder.decode(data.subarray(offset, offset + 4));
    if (!/^[a-f0-9]{4}$/.test(prefix)) throw Error('Invalid Git reference advertisement.');
    const length = parseInt(prefix, 16);
    if (length < 4) {offset += 4; continue;}
    if (offset + length > data.length) throw Error('Incomplete Git reference advertisement.');
    const packet = decoder.decode(data.subarray(offset + 4, offset + length));
    offset += length;
    const head = packet.match(/^([a-f0-9]{40}|[a-f0-9]{64}) HEAD\0/);
    if (head) return {revision: head[1], ref: packet.match(/symref=HEAD:refs\/heads\/([^\s\0]+)/)?.[1] || 'HEAD'};
  }
  throw Error('This repository is empty or has no default branch.');
}

export async function sourcehutArchive(repository, signal, request) {
  const refsResponse = await request(`${repository.url}/info/refs?service=git-upload-pack`, signal, 'application/x-git-upload-pack-advertisement');
  const {revision, ref} = gitHead(await readBounded(refsResponse.body, 1_000_000, 'Git references', signal));
  const response = await request(`${repository.url}/archive/${revision}.tar.gz`, signal, 'application/gzip');
  const compressed = await readBounded(response.body, 32_000_000, 'Compressed archive', signal);
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
  const data = await readBounded(stream, 100_000_000, 'Expanded archive', signal);
  const archive = parseTar(data);
  if (archive.revision !== revision) throw Error('The archive commit does not match the requested revision.');
  return {...archive, ref};
}
