class ApiGateway {
  constructor(config) {
    this.config = config;
    const url = new URL(config.apiBaseUrl);
    if (!(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))))
      throw new Error('Sunucu adresi HTTPS olmalı. Yerel sunucu için localhost kullanılabilir.');
    if (typeof config.deviceKey !== 'string' || config.deviceKey.length < 40) throw new Error('Kiosk cihaz anahtarı eksik.');
  }
  async request(endpoint, token, body) {
    let response;
    try {
      response = await fetch(this.config.apiBaseUrl.replace(/\/$/, '') + endpoint, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : { 'X-Kiosk-Key': this.config.deviceKey }) },
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(12000), redirect: 'error',
      });
    } catch { throw new Error('Sunucuya ulaşılamıyor. Lütfen yetkiliden yardım iste.'); }
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
  login(cardUid) { return this.request('/kiosk/card-login', null, { cardUid }); }
  loginWithPassword(identifier, password) { return this.request('/kiosk/password-login', null, { identifier, password }); }
  pcAvailability() { return this.read('/kiosk/pc-availability', null); }
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
