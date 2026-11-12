// Production server for the home computer (behind Cloudflare Tunnel): the same
// app as `next start`, plus one log line per request, which `next start` does
// not print in production. Vercel never runs this file.
//
//   npm run build && npm run start:home
//
// Env: PORT (3000), HOST (127.0.0.1: only the tunnel on this machine can reach it),
//      LOG_STATIC=1 to also log /_next/static, images and other files (noisy).
import { createServer } from 'node:http';
import next from 'next';

const port = Number(process.env.PORT || 3000);
const hostname = process.env.HOST || '127.0.0.1';
const logStatic = process.env.LOG_STATIC === '1';

const app = next({ dev: false, hostname, port });
const handle = app.getRequestHandler();

/** Build output, icons, fonts, images: one page load fetches dozens. */
const isStatic = (path) => path.startsWith('/_next/static/') || path.startsWith('/_next/image') || /\.(?:js|css|map|png|jpe?g|gif|svg|webp|ico|woff2?|txt|xml)$/i.test(path);

const time = () => new Date().toLocaleTimeString('en-GB', { hour12: false });

await app.prepare();

const server = createServer((req, res) => {
  const started = process.hrtime.bigint();
  const path = (req.url || '/').split('?')[0];
  if (logStatic || !isStatic(path)) {
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      // Cloudflare passes the visitor's real IP; the connection itself comes from the tunnel.
      const ip = req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '-';
      const who = req.headers['x-line-access-token'] ? ' LIFF' : '';
      const flag = res.statusCode >= 500 ? ' ‼' : res.statusCode >= 400 ? ' !' : '';
      console.log(`${time()} ${res.statusCode}${flag} ${req.method} ${path} ${ms.toFixed(0)}ms ${ip}${who}`);
    });
  }
  handle(req, res).catch((error) => {
    console.error(`${time()} handler error ${req.method} ${path}:`, error);
    if (!res.headersSent) res.writeHead(500).end('Internal Server Error');
  });
});

server.listen(port, hostname, () => console.log(`> Pudding (production) on http://${hostname}:${port}`));

// Ctrl-C / stop: finish requests in flight, then exit.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n${signal}: closing…`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
