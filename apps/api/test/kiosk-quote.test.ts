import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateQuote } from "../src/payments/service";
import { createApp } from "../src/app";

test("selected campaign uses server limits and rejects ineligible or expired selections", () => {
  const p = { id: 'ten', title: 'Bonus', description: 'Bonus kampanyası', terms: 'Koşullar', minimumAmount: 20000,
    bonusPercent: 10, maxBonus: 100000, startsAt: '2020-01-01', endsAt: '2099-01-01', accent: 'blue' as const };
  const offers = [p, { ...p, id: 'twenty', bonusPercent: 20, maxBonus: 30000 }];
  assert.equal(calculateQuote(200100, offers).bonus, 30000);
  assert.equal(calculateQuote(200100, offers, Date.now(), 'ten').bonus, 20010);
  assert.equal(calculateQuote(200100, offers, Date.now(), 'ten').total, 220110);
  assert.throws(() => calculateQuote(10000, offers, Date.now(), 'ten'));
  assert.throws(() => calculateQuote(200100, offers, Date.now(), 'missing'));
  assert.throws(() => calculateQuote(200100, [{ ...p, endsAt: '2021-01-01' }], Date.now(), 'ten'));
});

test("kiosk quote endpoint requires authentication", async () => {
  const app = await createApp({ ENVIRONMENT: 'test', DEMO_PASSWORD: 'test-password' });
  try {
    await app.listen(0, '127.0.0.1');
    const response = await fetch(await app.getUrl() + '/api/v1/kiosk/quote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: 20000 }),
    });
    assert.equal(response.status, 401);
  } finally { await app.close(); }
});
