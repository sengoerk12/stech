class ApiGateway {
  constructor(config) {
    this.config = config;
    const url = new URL(config.apiBaseUrl);
    if (!(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))))
      throw new Error('Sunucu adresi HTTPS olmalı. Yerel sunucu için localhost kullanılabilir.');
    if (typeof config.deviceKey !== 'string' || config.deviceKey.length < 40) throw new Error('Kiosk cihaz anahtarı eksik.');
  }
  async request(endpoint, token, body, extraHeaders = {}) {
    let response;
    try {
      response = await fetch(this.config.apiBaseUrl.replace(/\/$/, '') + endpoint, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', 'X-Kiosk-Key': this.config.deviceKey, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders },
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(endpoint.endsWith('/start') ? 45000 : endpoint === '/kiosk/pos-payments' ? 25000 : 12000), redirect: 'error',
      });
    } catch { throw new Error('Sunucuya ulaşılamıyor. Lütfen yetkiliden yardım iste.'); }
    if (response.status === 304) return null;
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw Object.assign(new Error(data?.message || 'İşlem tamamlanamadı.'), { status: response.status });
    }
    return response.json();
  }
  async read(endpoint, token) {
    try { return await this.request(endpoint, token); }
    catch (error) {
      if (error.status !== undefined && ![502, 503, 504].includes(error.status)) throw error;
      await new Promise(resolve => setTimeout(resolve, 400));
      return this.request(endpoint, token);
    }
  }
  quote(token, payload) { return this.request('/kiosk/quote', token, { amount: payload.amount, promotionId: payload.promotionId }); }
  createPosPayment(token, { amount, promotionId, key }) {
    return this.request('/kiosk/pos-payments', token, { amount, promotionId }, { 'Idempotency-Key': key });
  }
  posPayment(token, id) {
    return this.read('/kiosk/pos-payments/' + encodeURIComponent(id), token);
  }
  cancelPosPayment(token, id) {
    return this.request('/kiosk/pos-payments/' + encodeURIComponent(id) + '/cancel', token, {});
  }
  login(cardUid) { return this.request('/kiosk/card-login', null, { cardUid }); }
  loginWithPassword(identifier, password) { return this.request('/kiosk/password-login', null, { identifier, password }); }
  keepKioskAlive(token) { return this.request('/kiosk/session/keep-alive', token, {}); }
  async design() { const result=await this.request('/kiosk/design',null,undefined,this.designVersion?{'If-None-Match':'"'+this.designVersion+'"'}:{});if(result?.id)this.designVersion=result.id;return result; }
  pcAvailability() { return this.read('/kiosk/pc-availability', null); }
  computers(token) { return this.read('/kiosk/computers', token); }
  sCoin(token) { return this.read('/kiosk/s-coin', token); }
  sCoinPlay(token, { operationId, game }) { return this.request('/kiosk/s-coin/play', token, { operationId, game }); }
  startComputer(token, payload) {
    return this.request(`/kiosk/computers/${encodeURIComponent(payload.terminalId)}/start`, token, { operationId: payload.operationId });
  }
  computerStatus(token, payload) {
    return this.read(`/kiosk/computers/${encodeURIComponent(payload.terminalId)}/start/${encodeURIComponent(payload.operationId)}`, token);
  }
  async dashboard(token) {
    try { return await this.read('/kiosk/dashboard', token); }
    catch (error) {
      if (error.status !== 404) throw error;
      return this.read('/me/dashboard', token);
    }
  }
  transactions(token, cursor) { return this.read('/me/transactions' + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''), token); }
  sessions(token, cursor) { return this.read('/me/session-history' + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''), token); }
  logout(token) { return this.request('/auth/logout', token, {}); }
}
module.exports = { ApiGateway };
