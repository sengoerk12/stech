const { scryptSync, createHash, randomBytes } = require('node:crypto');
const { normalizeCard } = require('../electron/core.cjs');
const command = process.argv[2];
if (command === 'device-key') console.log(randomBytes(48).toString('base64url'));
else if (command === 'pin-hash') {
  // Use stdin so the PIN never appears in shell history / process arguments.
  let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => input += chunk);
  process.stdin.on('end', () => {
    const pin = input.trim();
    if (!/^\d{6,16}$/.test(pin)) { console.error('6–16 rakamdan oluşan bir PIN girin.'); process.exitCode = 1; return; }
    console.log(scryptSync(pin, 'stech-kiosk-admin-v1', 64).toString('hex'));
  });
} else if (command === 'card-hash') {
  let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => input += chunk);
  process.stdin.on('end', () => { try { console.log(createHash('sha256').update(normalizeCard(input)).digest('hex')); } catch (error) { console.error(error.message); process.exitCode = 1; } });
} else { console.log('node scripts/provision.cjs device-key | pin-hash | card-hash\nPIN ve kart kimliği stdin üzerinden okunur.'); }
