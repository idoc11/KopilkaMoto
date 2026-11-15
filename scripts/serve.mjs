// Простой статический сервер для разработки и тестов: node scripts/serve.mjs [папка] [порт]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.md': 'text/plain; charset=utf-8',
};

export function startServer(root = '.', port = 0, overrides = new Map()) {
  const base = resolve(root);
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (overrides.has(path)) {
        res.writeHead(200, {
          'Content-Type': TYPES[extname(path)] || 'text/plain',
          'Cache-Control': 'no-cache',
        });
        return res.end(overrides.get(path));
      }
      let file = normalize(join(base, path));
      if (file !== base && !file.startsWith(base + sep)) throw new Error('outside');
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    }
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = await startServer(
    process.argv[2] || '.',
    Number(process.argv[3] || process.env.PORT || 8080),
  );
  console.log(`KopilkaMoto: http://localhost:${server.address().port}/`);
}
