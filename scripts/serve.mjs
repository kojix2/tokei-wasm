import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, extname, sep} from 'node:path';

const root = fileURLToPath(new URL('../docs/', import.meta.url));
const portArgument = process.argv.indexOf('--port');
const port = Number(portArgument >= 0 ? process.argv[portArgument + 1] : process.env.PORT || 8000);
const mime = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png'};
const server = createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) {res.writeHead(405);res.end();return;}
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let filename = resolve(root, `.${pathname}`);
    if (filename !== root.slice(0, -1) && !filename.startsWith(root.replace(/\/$/, '') + sep)) {
      res.writeHead(403);res.end('Forbidden');return;
    }
    if ((await stat(filename)).isDirectory()) filename = resolve(filename, 'index.html');
    const content = await readFile(filename);
    res.writeHead(200, {'Content-Type': mime[extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-cache'});
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch {res.writeHead(404);res.end('Not found');}
});
server.on('error', error => {console.error(error.message);process.exitCode = 1;});
server.listen(port, '127.0.0.1', () => console.log(`tokei is ready at http://127.0.0.1:${port}`));
