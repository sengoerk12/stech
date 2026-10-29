const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const money = amount => Number.isSafeInteger(amount) && amount >= 5000 && amount <= 1000000;
function quote(amount, promotions, now = Date.now()) {
  if (!money(amount)) throw new Error('50 TL ile 10.000 TL arasında bir tutar seç.');
  const best = promotions.filter(p => now >= Date.parse(p.startsAt) && now < Date.parse(p.endsAt) && amount >= p.minimumAmount)
    .map(p => ({ id: p.id, bonus: Math.min(Math.floor(amount * p.bonusPercent / 100), p.maxBonus) }))
    .sort((a, b) => b.bonus - a.bonus)[0];
  return { amount, bonus: best?.bonus || 0, total: amount + (best?.bonus || 0) };
}
function normalizeCard(value) {
  if (typeof value !== 'string') throw new Error('Kart okunamadı. Tekrar okut.');
  const uid = value.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{4,64}$/.test(uid)) throw new Error('Kart okunamadı. Tekrar okut.');
  return uid;
}
const campaign = {
  id: 'kiosk-bonus', title: 'OYUNUN DAHA UZUN SÜRSÜN.',
  description: '200 TL ve üzeri yüklemene %10 bonus.', minimumAmount: 20000,
  bonusPercent: 10, maxBonus: 100000, startsAt: '2026-01-01T00:00:00Z', endsAt: '2027-01-01T00:00:00Z',
  terms: '200 TL ve üzeri tek yüklemede %10 bonus. En fazla 1.000 TL bonus. Bu kampanya deneme ortamına aittir.', accent: 'orange'
};
class DemoStore {
  constructor(file) { this.file = file; this.chain = Promise.resolve(); }
  async initialize() {
    try { this.state = JSON.parse(await fs.readFile(this.file, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Deneme verileri okunamadı. Yetkiliden yardım iste.');
      this.state = { balances: { 'DEMO0001': 74250, 'DEMO0002': 12500 }, transactions: {}, payments: {} };
      for (const card of Object.keys(this.state.balances)) this.state.transactions[card] = [
        { id: randomUUID(), kind: 'usage', amount: -8250, title: 'PC kullanımı · PC 27', createdAt: new Date().toISOString(), balanceAfter: this.state.balances[card] },
        { id: randomUUID(), kind: 'topup', amount: 20000, title: 'Kasa bakiye yükleme', createdAt: new Date(Date.now() - 86400000).toISOString(), balanceAfter: this.state.balances[card] + 8250 }
      ];
      await this.save();
    }
  }
  async save() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file + '.tmp', JSON.stringify(this.state), { mode: 0o600 });
    await fs.rename(this.file + '.tmp', this.file);
  }
  assert(card) { if (!Object.hasOwn(this.state.balances, card)) throw new Error('Bu kart tanımlı değil. S TECH yetkilisine başvur.'); }
  async dashboard(card) {
    this.assert(card);
    return {
      member: { id: card, name: card === 'DEMO0001' ? 'Kaan' : 'Deniz', username: card === 'DEMO0001' ? 'kaan' : 'deniz', joinedAt: '2026-01-15', phone: '', email: '', level: 'S TECH Üye' },
      wallet: { balance: this.state.balances[card], currency: 'TRY', updatedAt: new Date().toISOString() },
      promotions: [campaign].filter(p => Date.now() < Date.parse(p.endsAt)),
      transactions: this.state.transactions[card].slice(0, 5),
      pendingPayments: Object.values(this.state.payments).filter(p => p.card === card && p.status === 'pending'),
      features: { topup: true },
    };
  }
  async transactions(card, cursor) {
    this.assert(card);
    const offset = cursor ? Number(cursor) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Geçersiz sayfa.');
    const all = this.state.transactions[card];
    return { items: all.slice(offset, offset + 20), nextCursor: offset + 20 < all.length ? String(offset + 20) : undefined };
  }
  serial(fn) { const next = this.chain.then(fn); this.chain = next.catch(() => {}); return next; }
  async create(card, amount, key) {
    return this.serial(async () => {
      this.assert(card);
      const old = Object.values(this.state.payments).find(p => p.card === card && p.key === key);
      if (old) { if (old.amount !== amount) throw new Error('İşlem tutarı değişmiş.'); return structuredClone(old); }
      const q = quote(amount, (await this.dashboard(card)).promotions);
      const p = { ...q, id: randomUUID(), card, key, status: 'pending', createdAt: new Date().toISOString() };
      this.state.payments[p.id] = p;
      try { await this.save(); } catch (error) { delete this.state.payments[p.id]; throw error; }
      return structuredClone(p);
    });
  }
  get(card, id) {
    const p = this.state.payments[id];
    if (!p || p.card !== card) throw new Error('İşlem bulunamadı.');
    return structuredClone(p);
  }
  async settle(card, id, outcome) {
    return this.serial(async () => {
      const p = this.get(card, id);
      if (!['approved', 'declined'].includes(outcome)) throw new Error('Geçersiz POS sonucu.');
      if (p.status !== 'pending') return p;
      const snapshot = structuredClone(this.state);
      try {
        if (outcome === 'declined') p.status = 'failed';
        else {
          this.state.balances[card] += p.amount + p.bonus;
          p.balanceAfter = this.state.balances[card];
          p.status = 'completed';
          const rows = [{ id: `${id}-topup`, kind: 'topup', amount: p.amount, title: 'Kiosk bakiye yükleme', createdAt: new Date().toISOString(), balanceAfter: p.balanceAfter - p.bonus }];
          if (p.bonus) rows.unshift({ id: `${id}-bonus`, kind: 'bonus', amount: p.bonus, title: 'Yükleme bonusu', createdAt: new Date().toISOString(), balanceAfter: p.balanceAfter });
          this.state.transactions[card].unshift(...rows);
        }
        this.state.payments[id] = p;
        await this.save();
        return structuredClone(p);
      } catch (error) { this.state = snapshot; throw error; }
    });
  }
}
module.exports = { DemoStore, quote, normalizeCard };
