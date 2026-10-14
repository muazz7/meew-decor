import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { pbkdf2Sync, randomBytes } from 'node:crypto';

if (process.argv.includes('--help')) {
  console.log('Run node scripts/hash-admin-password.mjs in a terminal. Enter and confirm the owner password in the hidden prompts. The command prints STORE_ADMIN_PASSWORD_HASH and a new STORE_SESSION_SECRET for secure hosting configuration. It does not write files.');
  process.exit(0);
}
if (process.argv.length !== 2 || !process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('Run this command interactively. Do not pass passwords as arguments or environment variables.');
  process.exit(1);
}
const muted = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
const prompt = createInterface({ input: process.stdin, output: muted, terminal: true });
prompt.on('SIGINT', () => { prompt.close(); process.stdout.write('\nCancelled.\n'); process.exit(130); });
try {
  process.stdout.write('Owner password (at least 16 characters; input hidden): ');
  const password = await prompt.question('');
  process.stdout.write('\nConfirm owner password (input hidden): ');
  const confirmation = await prompt.question('');
  process.stdout.write('\n');
  if (password !== confirmation) throw new Error('Passwords do not match.');
  if (password.length < 16 || Buffer.byteLength(password, 'utf8') > 1024) throw new Error('Use at least 16 characters and at most 1024 bytes.');
  const salt = randomBytes(32);
  const digest = pbkdf2Sync(password, salt, 600000, 32, 'sha256');
  console.log('\nAdd these values to the hosting environment. Keep them private.\n');
  console.log(`STORE_ADMIN_PASSWORD_HASH=pbkdf2_sha256$600000$${salt.toString('base64url')}$${digest.toString('base64url')}`);
  console.log(`STORE_SESSION_SECRET=${randomBytes(48).toString('base64url')}`);
  console.log('\nSet STORE_ADMIN_EMAIL separately to the actual owner email. Rotating either value above invalidates existing owner sessions.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Password setup failed.');
  process.exitCode = 1;
} finally { prompt.close(); }
