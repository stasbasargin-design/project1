import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import webpush from 'web-push';

const [destination, subject] = process.argv.slice(2);
if (!destination || !/^(mailto:|https:\/\/)/.test(subject || '')) {
  console.error('Usage: node scripts/generate-vapid.mjs /secure/path/web-push.env mailto:REAL_ADMIN_EMAIL');
  process.exit(1);
}
const keys = webpush.generateVAPIDKeys();
// Exclusive creation: never silently rotate keys and invalidate all installed subscriptions.
writeFileSync(resolve(destination), `WEB_PUSH_VAPID_PUBLIC_KEY=${keys.publicKey}\nWEB_PUSH_VAPID_PRIVATE_KEY=${keys.privateKey}\nWEB_PUSH_VAPID_SUBJECT=${subject}\n`, {flag:'wx',mode:0o600});
console.log('VAPID configuration created in the specified file. No keys printed. Keep it outside Git and the public application directory.');
