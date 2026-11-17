const { quote } = require('./core.cjs');

// Local fixtures for the connected kiosk UI. This gateway performs no network I/O.
class DesignPreviewGateway {
  constructor(store) {
    this.store = store;
    this.starts = new Map();
    this.spins = new Map();
    this.coins = new Map();
    this.terminals = [
      ['Beginner', 17], ['Player Zone', 10], ['Gamer Zone', 10],
      ['Master Zone', 5], ['Master 2 Zone', 5], ['PC-', 2],
    ].flatMap(([zone, count], group) => Array.from({ length: count }, (_, index) => {
      const number = index + 1;
      const canWake = number === 3;
      const available = number % 4 !== 2;
      return {
        id: String(group * 100 + number),
        name: zone === 'PC-' ? zone + number : zone + ' ' + number,
        status: canWake ? 'offline' : available ? 'available' : 'occupied',
        available, canWake, canStart: available, virtual: false,
      };
    }));
  }

  async login(card) {
    this.store.assert(card);
    return { accessToken: card };
  }

  async loginWithPassword(username, password) {
    const card = { kaan: 'DEMO0001', deniz: 'DEMO0002' }[username.toLowerCase()];
    if (!card || password !== '2026') throw new Error('Kullanıcı adı veya şifre hatalı.');
    return this.login(card);
  }

  async logout() {}
  async keepKioskAlive() {}
  async design() { return null; }
  async pcAvailability() {
    return { total: this.terminals.length, available: this.terminals.filter(pc => pc.available).length };
  }
  async computers() {
    return { startSupported: true, computers: structuredClone(this.terminals) };
  }

  async dashboard(card) {
    const data = await this.store.dashboard(card);
    const promotions = data.promotions.map(promotion => ({
      ...promotion, terms: promotion.terms.replace(' Bu kampanya deneme ortamına aittir.', ''),
    }));
    return {
      ...data, promotions,
      member: { ...data.member, memberNumber: card === 'DEMO0001' ? '1' : '2' },
      pendingPayments: data.pendingPayments.map(payment => this.paymentView(payment)),
      features: { ...data.features, odealPos: true },
    };
  }
  async transactions(card, cursor) { return this.store.transactions(card, cursor); }
  async history(card) { return this.store.history(card); }
  async sessions() {
    const end = Date.now() - 3600000;
    const example = {
      terminal: 'Beginner 4', durationMinutes: 60, usageAmount: 8250,
      startedAt: new Date(end - 3600000).toISOString(), endedAt: new Date(end).toISOString(),
    };
    return { items: [example] };
  }
  async quote(card, payload) {
    return quote(payload.amount, (await this.dashboard(card)).promotions, Date.now(), payload.promotionId);
  }
  paymentView(payment) {
    return { ...payment, awaitingTerminal: payment.status === 'pending' };
  }
  async createPosPayment(card, payload) {
    return this.paymentView(await this.store.create(card, payload.amount, payload.key, payload.promotionId));
  }
  async posPayment(card, id) { return this.paymentView(this.store.get(card, id)); }
  async cancelPosPayment(card, id) { return this.settlePreviewPayment(card, { id, outcome: 'declined' }); }
  async settlePreviewPayment(card, { id, outcome }) {
    return this.paymentView(await this.store.settle(card, id, outcome));
  }

  async startComputer(card, { terminalId, operationId }) {
    const key = card + ':' + operationId;
    if (this.starts.has(key)) return this.starts.get(key);
    const terminal = this.terminals.find(pc => pc.id === terminalId && pc.available);
    if (!terminal) return { status: 'not_started', message: 'Bu bilgisayar artık boş değil.' };
    Object.assign(terminal, { available: false, status: 'occupied', canWake: false, canStart: false });
    const result = { status: 'started', message: terminal.name + ' için oturum başlatıldı.' };
    this.starts.set(key, result);
    return result;
  }
  async computerStatus(card, { operationId }) {
    return this.starts.get(card + ':' + operationId) || { status: 'not_started', message: 'Oturum bulunamadı.' };
  }

  async sCoin(card) {
    const playableCoins = this.coins.get(card) ?? 12;
    return { units: playableCoins * 10000, unitsPerCoin: 10000, playableCoins, testOnly: false };
  }
  async sCoinPlay(card, { game, operationId }) {
    return this.store.serial(async () => {
      this.store.assert(card);
      const key = card + ':' + operationId;
      if (this.spins.has(key)) return this.spins.get(key);
      const balance = this.coins.get(card) ?? 12;
      if (game !== 'wheel' || balance < 1) throw new Error('Bu tur başlatılamadı.');
      const amountKurus = 500;
      const result = { game, sector: 1, prize: { kind: 'balance', title: '5 TL oyun bakiyesi', amountKurus }, testOnly: false };
      const snapshot = structuredClone(this.store.state);
      this.store.state.balances[card] += amountKurus;
      this.store.state.transactions[card].unshift({
        id: key, kind: 'game_reward', amount: amountKurus, title: 'Şans çarkı ödülü',
        balanceAfter: this.store.state.balances[card], createdAt: new Date().toISOString(),
      });
      try { await this.store.save(); } catch (error) { this.store.state = snapshot; throw error; }
      this.coins.set(card, balance - 1);
      this.spins.set(key, result);
      return result;
    });
  }
}

module.exports = { DesignPreviewGateway };
