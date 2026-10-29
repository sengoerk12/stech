const { normalizeCard, quote } = require('./core.cjs');

class KioskSession {
  constructor({ demo, gateway, mode, idleSeconds = 90, completionSeconds = 20, onLock = () => {} }) {
    this.demo = demo; this.gateway = gateway; this.mode = mode; this.idleMs = idleSeconds * 1000; this.onLock = onLock;
    this.generation = 0; this.session = null; this.busy = false;
    this.completionMs = Math.max(5, Math.min(60, Number(completionSeconds) || 20)) * 1000;
  }
  touch(now = Date.now()) { if (this.session) this.session.activity = now; }
  remaining(now = Date.now()) {
    return this.session ? Math.max(0, Math.ceil((Math.min(
      this.session.completionDeadline ?? this.session.activity + this.idleMs,
      this.session.started + 300000,
    ) - now) / 1000)) : 0;
  }
  tick(now = Date.now()) { if (this.session && this.remaining(now) <= 0) this.lock(); }
  lock() {
    const old = this.session; this.session = null; this.generation++; this.busy = false;
    if (old?.token) void this.gateway.logout(old.token).catch(() => {});
    this.onLock();
  }
  async scan(value) {
    if (this.session || this.busy) throw new Error('Önce mevcut oturumu bitir.');
    this.busy = true;
    const epoch = this.generation;
    const started = Date.now();
    let token;
    try {
      const card = normalizeCard(value);
      if (this.mode === 'connected') token = (await this.gateway.login(card)).accessToken;
      const data = this.mode === 'demo' ? await this.demo.dashboard(card) : await this.gateway.dashboard(token);
      if (epoch !== this.generation) {
        if (token) void this.gateway.logout(token).catch(() => {});
        throw new Error('Oturum kapandı. Kartını tekrar okut.');
      }
      this.session = { card, token, started, activity: Date.now() };
      return this.publicDashboard(data);
    } catch (error) {
      if (token && !this.session) void this.gateway.logout(token).catch(() => {});
      throw error;
    } finally { if (epoch === this.generation) this.busy = false; }
  }
  publicDashboard(data) {
    // The existing payment provider is a mobile simulation, never a POS authorization.
    const nameParts = data.member.name?.trim().split(/\s+/) || [];
    if (nameParts.length > 1 && nameParts.at(-1).toUpperCase() === this.session?.card) nameParts.pop();
    return { ...data, member: { ...data.member, name: nameParts.join(' ') || data.member.username },
      pendingPayments: this.mode === 'demo' ? data.pendingPayments : [],
      features: { ...data.features, topup: this.mode === 'demo' }, kioskMode: this.mode };
  }
  async run(action, payload = {}) {
    this.tick();
    if (action === 'scan') return this.scan(payload.uid);
    if (action === 'logout') { this.lock(); return { ok: true }; }
    if (action === 'activity') { this.touch(); return { remaining: this.remaining() }; }
    this.tick();
    const session = this.session, epoch = this.generation;
    if (!session) throw new Error('Kartını okutarak tekrar giriş yap.');
    if (action === 'continueSession') {
      if (!session.completionDeadline) throw new Error('Tamamlanmış işlem bulunamadı.');
      delete session.completionDeadline;
      this.touch();
      return { remaining: this.remaining() };
    }
    if (session.completionDeadline && !['dashboard', 'payment', 'settle'].includes(action))
      throw new Error('Devam etmek için “Başka bir işlem yap” seçeneğine dokun.');
    let result;
    if (action === 'dashboard') result = this.publicDashboard(this.mode === 'demo' ? await this.demo.dashboard(session.card) : await this.gateway.dashboard(session.token));
    else if (action === 'transactions') result = this.mode === 'demo' ? await this.demo.transactions(session.card, payload.cursor) : await this.gateway.transactions(session.token, payload.cursor);
    else if (action === 'sessions') result = this.mode === 'demo' ? { items: [] } : await this.gateway.sessions(session.token, payload.cursor);
    else if (['quote', 'create', 'settle', 'payment'].includes(action)) {
      if (this.mode !== 'demo') throw new Error('POS bağlantısı henüz etkin değil. Yükleme için S TECH yetkilisine başvur.');
      if (action === 'quote') result = quote(payload.amount, (await this.demo.dashboard(session.card)).promotions);
      if (action === 'create') {
        if (typeof payload.key !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(payload.key)) throw new Error('Geçersiz işlem anahtarı.');
        result = await this.demo.create(session.card, payload.amount, payload.key);
      }
      if (action === 'payment') result = this.demo.get(session.card, payload.id);
      if (action === 'settle') result = await this.demo.settle(session.card, payload.id, payload.outcome);
    } else throw new Error('Geçersiz işlem.');
    this.tick();
    if (epoch !== this.generation) throw new Error('Oturum kapandı. Kartını tekrar okut.');
    if (['settle', 'payment'].includes(action) && result.status === 'completed') {
      if (session.completionPaymentId !== result.id) {
        session.completionPaymentId = result.id;
        session.completionDeadline = Date.now() + this.completionMs;
      }
      if (session.completionDeadline) return { ...result, completionSeconds: this.remaining() };
    }
    return result;
  }
}
module.exports = { KioskSession };
