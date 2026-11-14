const { normalizeCard, quote } = require('./core.cjs');

class KioskSession {
  constructor({ demo, gateway, mode, idleSeconds = 90, completionSeconds = 20, onLock = () => {} }) {
    this.demo = demo; this.gateway = gateway; this.mode = mode; this.idleMs = idleSeconds * 1000; this.onLock = onLock;
    this.generation = 0; this.session = null; this.busy = false;
    this.countdownRevision = 0;
    this.completionMs = Math.max(5, Math.min(60, Number(completionSeconds) || 20)) * 1000;
  }
  touch(now = Date.now()) { if (this.session) this.session.activity = now; }
  remaining(now = Date.now()) {
    return this.session ? Math.max(0, Math.ceil((Math.min(
      this.session.completionDeadline ?? this.session.activity + this.idleMs,
      this.session.started + 300000,
    ) - now) / 1000)) : 0;
  }
  countdown(now = Date.now()) {
    return {
      revision: ++this.countdownRevision,
      remaining: this.remaining(now),
      canContinue: Boolean(this.session && !this.session.completionDeadline && this.session.started + 300000 - now > 15000),
    };
  }
  tick(now = Date.now()) { if (this.session && this.remaining(now) <= 0) this.lock(); }
  lock() {
    const old = this.session; this.session = null; this.generation++; this.busy = false;
    if (old?.token) void this.gateway.logout(old.token).catch(() => {});
    this.onLock();
  }
  async scan(value) {
    const card = normalizeCard(value);
    return this.startSession(card, () => this.gateway.login(card));
  }
  async loginWithPassword(payload) {
    if (this.mode !== 'connected') throw new Error('Kullanıcı adıyla giriş için PanCafe bağlantısı gerekli.');
    const { username, password } = payload ?? {};
    if (typeof username !== 'string' || !username.trim() || username.length > 120 ||
        typeof password !== 'string' || !password || password.length > 256)
      throw new Error('Kullanıcı adını ve şifreni gir.');
    return this.startSession(undefined, () => this.gateway.loginWithPassword(username.trim(), password));
  }
  async startSession(card, authenticate) {
    if (this.session || this.busy) throw new Error('Önce mevcut oturumu bitir.');
    this.busy = true;
    const epoch = this.generation;
    const started = Date.now();
    let token;
    try {
      if (this.mode === 'connected') token = (await authenticate()).accessToken;
      const data = this.mode === 'demo' ? await this.demo.dashboard(card) : await this.gateway.dashboard(token);
      if (epoch !== this.generation) throw new Error('Oturum kapandı. Tekrar giriş yap.');
      this.session = { card, token, started, activity: Date.now() };
      this.session.odealPos = data.features?.odealPos === true;
      return this.publicDashboard(data);
    } catch (error) {
      if (token && this.session?.token !== token) void this.gateway.logout(token).catch(() => {});
      throw error;
    } finally { if (epoch === this.generation) this.busy = false; }
  }
  publicDashboard(data) {
    const nameParts = data.member.name?.trim().split(/\s+/) || [];
    if (nameParts.length > 1 && nameParts.at(-1).toUpperCase() === this.session?.card) nameParts.pop();
    return { ...data, member: { ...data.member, name: nameParts.join(' ') || data.member.username },
      pendingPayments: this.mode === 'demo' || data.features?.odealPos === true ? data.pendingPayments : [],
      features: { ...data.features, topup: this.mode === 'demo' || (data.features?.odealPos === true && data.features.topup === true) }, kioskMode: this.mode };
  }
  async run(action, payload = {}) {
    const now = Date.now();
    this.tick(now);
    if (action === 'design') { const update = this.mode === 'connected' ? await this.gateway.design() : null; if(update)this.designSnapshot=update; const result=this.designSnapshot||null; const seconds=result?.document?.behavior?.idleSeconds; if(!this.session&&Number.isInteger(seconds)&&seconds>=30&&seconds<=300)this.idleMs=seconds*1000;return result; }
    if (action === 'scan') return this.scan(payload.uid);
    if (action === 'passwordLogin') return this.loginWithPassword(payload);
    if (action === 'pcAvailability') {
      if (this.mode !== 'connected') return null;
      return this.gateway.pcAvailability();
    }
    if (action === 'logout') { this.lock(); return { ok: true }; }
    const session = this.session, epoch = this.generation;
    if (!session) throw new Error('Devam etmek için tekrar giriş yap.');
    if (action === 'activity') { this.touch(now); return this.countdown(now); }
    if (action === 'keepAlive') {
      const status = this.countdown(now);
      if (!status.canContinue) return status;
      this.touch(now);
      return this.countdown(now);
    }
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
    else if (action === 'sCoin' && this.mode === 'connected') result = await this.gateway.sCoin(session.token);
    else if (action === 'sCoinPlay' && this.mode === 'connected') result = await this.gateway.sCoinPlay(session.token, payload);
    else if (action === 'computers') {
      if (this.mode !== 'connected') throw new Error('Bilgisayar listesi için PanCafe bağlantısı gerekli.');
      result = await this.gateway.computers(session.token);
    }
    else if (action === 'startComputer' || action === 'computerStatus') {
      if (this.mode !== 'connected') throw new Error('Oturum açmak için PanCafe bağlantısı gerekli.');
      if (typeof payload.terminalId !== 'string' || !/^[1-9]\d{0,9}$/.test(payload.terminalId) ||
          typeof payload.operationId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(payload.operationId))
        throw new Error('Bilgisayar seçimini kontrol et.');
      if (session.startInFlight) throw new Error('Oturum açma işlemi zaten sürüyor.');
      if (session.unresolvedStart && (session.unresolvedStart.operationId !== payload.operationId || session.unresolvedStart.terminalId !== payload.terminalId))
        throw new Error('Önce devam eden oturum açma işlemini kontrol et.');
      session.startInFlight = true;
      session.unresolvedStart = { terminalId: payload.terminalId, operationId: payload.operationId };
      this.touch();
      try {
        result = await this.gateway[action](session.token, session.unresolvedStart);
        if (result.status !== 'pending') delete session.unresolvedStart;
      } finally { session.startInFlight = false; }
    }
    else if (action === 'transactions') result = this.mode === 'demo' ? await this.demo.transactions(session.card, payload.cursor) : await this.gateway.transactions(session.token, payload.cursor);
    else if (action === 'sessions') result = this.mode === 'demo' ? { items: [] } : await this.gateway.sessions(session.token, payload.cursor);
    else if (action === 'quote') result = this.mode === 'demo'
      ? quote(payload.amount, (await this.demo.dashboard(session.card)).promotions, Date.now(), payload.promotionId)
      : await this.gateway.quote(session.token, payload);
    else if (['create', 'settle', 'payment', 'cancel-payment'].includes(action)) {
      if (this.mode === 'connected') {
        if (!session.odealPos) throw new Error('POS bağlantısı henüz etkin değil. Yükleme için S TECH yetkilisine başvur.');
        if (action === 'settle') throw new Error('Ödeme sonucu POS cihazından alınır.');
        if (action === 'create') result = await this.gateway.createPosPayment(session.token, payload);
        else if (action === 'cancel-payment') result = await this.gateway.cancelPosPayment(session.token, payload.id);
        else result = await this.gateway.posPayment(session.token, payload.id);
      } else {
        if (action === 'cancel-payment') throw new Error('POS bağlantısı açık değil.');
        if (action === 'create') {
          if (typeof payload.key !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(payload.key)) throw new Error('Geçersiz işlem anahtarı.');
          result = await this.demo.create(session.card, payload.amount, payload.key, payload.promotionId);
        }
        if (action === 'payment') result = this.demo.get(session.card, payload.id);
        if (action === 'settle') result = await this.demo.settle(session.card, payload.id, payload.outcome);
      }
    } else throw new Error('Geçersiz işlem.');
    this.tick();
    if (epoch !== this.generation) throw new Error('Oturum kapandı. Tekrar giriş yap.');
    if (action === 'dashboard') session.odealPos = result.features?.odealPos === true;
    if (['settle', 'payment', 'cancel-payment'].includes(action) && result.status === 'completed') {
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
