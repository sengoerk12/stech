const fs = require('node:fs/promises');

const niluferForecast = 'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=40.2137&lon=28.9846';
const interval = 3 * 60 * 60 * 1000;
const maxForecastAge = 4 * interval;

function createLobbyWeather(cachePath, version) {
  let nextRequest = 0;
  let pending;
  const loaded = fs.readFile(cachePath, 'utf8').then(JSON.parse).catch(() => null);
  let cache;

  async function update(now) {
    nextRequest = now + interval;
    try {
      const headers = { 'User-Agent': `STechKiosk/${version} (https://github.com/sengoerk12/stech)` };
      if (cache?.lastModified) headers['If-Modified-Since'] = cache.lastModified;
      const response = await fetch(niluferForecast, {
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(6000),
      });

      const retryAfter = response.headers.get('retry-after');
      const retryAt = /^\d+$/.test(retryAfter ?? '') ? now + Number(retryAfter) * 1000 : Date.parse(retryAfter);
      nextRequest = Math.max(nextRequest, Date.parse(response.headers.get('expires')) || 0, retryAt || 0);
      if (response.status === 304 && cache) {
        cache = { ...cache, nextRequest, checkedAt: now };
      } else {
        if (!response.ok) return;
        const forecast = await response.json();
        const hours = (forecast.properties?.timeseries ?? []).map(hour => ({
          time: Date.parse(hour.time),
          temperature: hour.data?.instant?.details?.air_temperature,
          symbol: hour.data?.next_1_hours?.summary?.symbol_code,
        })).filter(hour => Number.isFinite(hour.time) && Number.isFinite(hour.temperature));
        if (!hours.length) return;
        cache = { hours, nextRequest, checkedAt: now, lastModified: response.headers.get('last-modified') };
      }
      await fs.writeFile(cachePath, JSON.stringify(cache), 'utf8');
    } catch {
      // Weather is optional for sign-in. Keep a recent forecast through a transient outage.
    }
  }

  return async function lobbyWeather() {
    if (cache === undefined) {
      cache = await loaded;
      nextRequest = Math.max(nextRequest, cache?.nextRequest || 0);
    }
    const now = Date.now();
    if (!pending && now >= nextRequest) pending = update(now).finally(() => { pending = undefined; });
    await pending;
    if (!Array.isArray(cache?.hours) || !Number.isFinite(cache.checkedAt) || now - cache.checkedAt > maxForecastAge) return null;
    const closest = cache.hours.reduce((best, hour) => Math.abs(hour.time - now) < Math.abs((best?.time ?? Infinity) - now) ? hour : best, null);
    if (!closest || Math.abs(closest.time - now) > 90 * 60 * 1000) return null;
    return { celsius: Math.round(closest.temperature), symbol: closest.symbol ?? '' };
  };
}

module.exports = { createLobbyWeather };
