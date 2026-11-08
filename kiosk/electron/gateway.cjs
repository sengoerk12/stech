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
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'İşlem tamamlanamadı.');
    return data;
  }
  login(cardUid) { return this.request('/kiosk/card-login', null, { cardUid }); }
  dashboard(token) { return this.request('/me/dashboard', token); }
  transactions(token, cursor) { return this.request('/me/transactions' + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''), token); }
  sessions(token, cursor) { return this.request('/me/session-history' + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''), token); }
  logout(token) { return this.request('/auth/logout', token, {}); }
}
module.exports = { ApiGateway };
