import { mkdir, copyFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const target = new URL('.wrangler/business/', root);
await mkdir(new URL('local_api/', target), { recursive: true });
// Explicit list keeps the local database, exporters, Telegram and seed out of the Worker.
for (const name of ['__init__', 'store', 'metrics', 'payment_progress', 'actions', 'action_common',
  'action_shipments', 'action_finance', 'action_master', 'action_alerts']) {
  const file = 'local_api/' + name + '.py';
  await copyFile(new URL(file, root), new URL(file, target));
}
await copyFile(new URL('cloudflare/business/organization.py', root), new URL('local_api/organization.py', target));
await copyFile(new URL('cloudflare/business/entry.py', root), new URL('entry.py', target));
