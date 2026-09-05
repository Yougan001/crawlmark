import { createInspectionServer } from './app.mjs';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? '8787');
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PORT must be an integer from 1 to 65535.');
if (
  host !== '127.0.0.1' &&
  (!process.env.ALLOWED_HOSTS || !process.env.ALLOWED_ORIGINS)
)
  throw new Error(
    'Public binding requires explicit ALLOWED_HOSTS and ALLOWED_ORIGINS. Read docs/security.md before exposing this API.',
  );

const server = createInspectionServer({
  hosts: process.env.ALLOWED_HOSTS?.split(',').map((value) =>
    value.trim().toLowerCase(),
  ) ?? [`127.0.0.1:${port}`, `localhost:${port}`],
  origins: process.env.ALLOWED_ORIGINS?.split(',').map((value) =>
    value.trim(),
  ) ?? ['http://localhost:5184'],
});
server.listen(port, host, () =>
  console.log(`Crawlmark inspection service listening on ${host}:${port}`),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    server.close();
    server.closeAllConnections();
  });
