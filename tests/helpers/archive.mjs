import {gzipSync} from 'node:zlib';

export const revision = 'a'.repeat(40);
export function tarEntry(name, content, type = '0') {
  const bytes = Buffer.from(content);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100);
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124);
  header.write('00000000000\0', 136);
  header.fill(32, 148, 156);
  header.write(type, 156);
  header.write('ustar\0', 257);
  header.write('00', 263);
  const checksum = header.reduce((total, byte) => total + byte, 0);
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512)]);
}
export function pax(key, value) {
  const field = `${key}=${value}\n`;
  let length = Buffer.byteLength(field) + 2;
  while (length !== Buffer.byteLength(`${length} ${field}`)) length = Buffer.byteLength(`${length} ${field}`);
  return `${length} ${field}`;
}
export function tarArchive(files = {'src/main.rs': 'fn main() {}\n// hi\n\n'}, extra = []) {
  return Buffer.concat([
    tarEntry('pax_global_header', pax('comment', revision), 'g'),
    ...Object.entries(files).map(([name, content]) => tarEntry(`demo-${revision}/${name}`, content)),
    ...extra, Buffer.alloc(1024),
  ]);
}
export const compressedArchive = files => gzipSync(tarArchive(files));
export const gitPacket = text => (4 + Buffer.byteLength(text)).toString(16).padStart(4, '0') + text;
export const refs = gitPacket('# service=git-upload-pack\n') + '0000' +
  gitPacket(`${revision} HEAD\0symref=HEAD:refs/heads/main\n`) + '0000';
