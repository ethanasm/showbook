import { createServer as createHttpsServer } from 'https';
import { createServer as createHttpServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { parse } from 'url';
import next from 'next';

const dev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT || '3001', 10);
const app = next({ dev, hostname: '0.0.0.0', port, dir: '/app/apps/web' });
const handle = app.getRequestHandler();

const certPath = '/app/certs/localhost-cert.pem';
const keyPath = '/app/certs/localhost-key.pem';

app.prepare().then(() => {
  const handler = async (req, res) => {
    const parsedUrl = parse(req.url, true);
    await handle(req, res, parsedUrl);
  };

  if (existsSync(certPath) && existsSync(keyPath)) {
    const httpsOptions = {
      key: readFileSync(keyPath),
      cert: readFileSync(certPath),
    };
    createHttpsServer(httpsOptions, handler).listen(port, '0.0.0.0', () => {
      console.log(`> Ready on https://localhost:${port}`);
    });
  } else {
    createHttpServer(handler).listen(port, '0.0.0.0', () => {
      console.log(`> Ready on http://localhost:${port} (no certs found)`);
    });
  }
});
