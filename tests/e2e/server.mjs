// Tiny local site for E2E tests: /page/<name> returns a titled page. Hosts: 127.0.0.1 and localhost.
import { createServer } from 'node:http';
const port = Number(process.env.PORT ?? 4517);
createServer((req, res) => {
  const name = decodeURIComponent((req.url ?? '/').split('/').pop() || 'home');
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html><title>${name}</title><h1>${name}</h1>`);
}).listen(port, () => console.log(`e2e server on ${port}`));
