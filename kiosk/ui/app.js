'use strict';
const $ = selector => document.querySelector(selector);
const root = $('#app');
const state = { info: null, data: null, page: 'home', epoch: 0, loading: false, walletStale: false, recentState: '', filter: 'all', history: [], historyLoading: false, historyError: '', amount: '200', quote: null, promotionId: undefined, quoteError: '', payment: null, processing: false, quoteVersion: 0, modal: null, pin: '', seconds: 90, clock: '' };
const e = text => String(text ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const cash = amount => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(amount / 100);
const balanceText = () => Number.isSafeInteger(state.data?.wallet?.balance) ? cash(state.data.wallet.balance) : '—';
const isDesignPreview = () => state.info?.designPreview === true;
const balanceCaption = () => isDesignPreview() ? 'Hesabındaki güncel bakiye' : state.info.mode === 'demo' ? 'Deneme bakiyesi · Gerçek para değildir'
  : state.walletStale ? 'Bakiye güncellenemedi. Son okunan değer gösteriliyor.' : 'PanCafe hesabındaki güncel bakiye';
let pcAvailability = 'Bilgisayar durumu alınıyor…';
let readingPcAvailability = false;
let readingFloorAvailability = false;
function floorMapGallery(computers) {
  const groups = new Map(ComputerZones.summarize(computers).map(group => [group.zone.id, group]));
  const sections = [['gamer', 'Gamer'], ['master', 'Master 1'], ['master2', 'Master 2'], ['beginner', 'Beginner'], ['player', 'Player']];
  return `<div class="floor-sheet floor-sheet-overview">${ComputerZones.floorMap(computers)}</div>${sections.map(([id, name]) => {
    const { zone, computers: rows, total, available } = groups.get(id);
    return `<section class="floor-sheet${id === 'beginner' || id === 'player' ? ' floor-sheet-wide' : ''}">
      <div class="floor-sheet-heading"><h3>${name}</h3>${total ? `<span>${available}/${total} kullanılabilir</span>` : ''}</div>
      ${ComputerZones.isoMap(zone, rows, null, false)}</section>`;
  }).join('')}`;
}
async function refreshFloorAvailability() {
  const map = $('#floor-map-content');
  if (state.modal !== 'floor-map' || !map || readingFloorAvailability) return;
  readingFloorAvailability = true;
  try {
    const computers = await call('floorAvailability');
    if (map.isConnected) {
      map.innerHTML = floorMapGallery(computers);
      $('#floor-map-status').textContent = '';
    }
  } catch {
    if (map.isConnected) {
      map.innerHTML = floorMapGallery([]);
      $('#floor-map-status').textContent = 'Canlı bilgisayar durumu alınamıyor.';
    }
  } finally { readingFloorAvailability = false; }
}
async function refreshPcAvailability() {
  if (state.info?.mode !== 'connected' || state.data || readingPcAvailability) return;
  readingPcAvailability = true;
  try {
    const { total, available } = await call('pcAvailability');
    pcAvailability = `${available}/${total} bilgisayar kullanılabilir`;
  } catch { pcAvailability = 'Bilgisayar durumu alınamıyor'; }
  finally { readingPcAvailability = false; }
  const label = $('#pc-availability');
  if (label && label.textContent !== pcAvailability) label.textContent = pcAvailability;
  void refreshFloorAvailability();
}
const date = value => new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const paths = {
 home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
 topup: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18m-5 4v4m-2-2h4"/>',
 campaigns: '<path d="m3 12 9-9h7l2 2v7l-9 9Z"/><circle cx="16" cy="8" r="1"/><path d="m8 12 4 4"/>',
 history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
 arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
 logout: '<path d="M9 4H4v16h5m5-13 5 5-5 5m-6-5h13"/>',
 nfc: '<rect x="3" y="5" width="11" height="14" rx="2"/><path d="M18 6a10 10 0 0 1 0 12m-2-9a5 5 0 0 1 0 6M7 9v6m3-6v6"/>',
 check: '<path d="m5 12 4 4L19 6"/>',
 close: '<path d="m6 6 12 12M6 18 18 6"/>',
 shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
 bolt: '<path d="m13 2-9 12h7l-1 8 10-13h-7Z"/>',
 plus: '<path d="M12 5v14M5 12h14"/>',
 back: '<path d="M20 12H4m6-6-6 6 6 6"/>',
 monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/>',
 barcode: '<path d="M8 3H4a1 1 0 0 0-1 1v4m13-5h4a1 1 0 0 1 1 1v4M3 16v4a1 1 0 0 0 1 1h4m8 0h4a1 1 0 0 0 1-1v-4M7 8v8m3-8v8m4-8v8m3-8v8"/>',
 info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>'
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.info}</svg>`;
const button = (text, action, cls = '', disabled = false) => `<button class="button ${cls}" data-action="${action}" ${disabled ? 'disabled' : ''}>${text}</button>`;
const logo = '<div class="brand"><img class="brand-wordmark" src="assets/brand-wordmark.png" alt="S TECH E-SPOR"></div>';
const badge = () => `<span class="status ${state.info?.mode === 'demo' && !isDesignPreview() ? 'demo' : ''}"><i></i>${state.info?.mode === 'demo' && !isDesignPreview() ? 'DENEME MODU' : 'ÜYE NOKTASI'}</span>`;
function toast(message) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { $('#toast').hidden = true; }, 6000);
}
function showInsufficientBalance() {
  const alert = $('#balance-warning');
  alert.hidden = false;
  clearTimeout(showInsufficientBalance.timer);
  showInsufficientBalance.timer = setTimeout(() => { alert.hidden = true; }, 5000);
}
async function call(action, payload) {
  if (!window.stech) throw new Error('Bu ekranı kiosk uygulamasından açın.');
  const result = await window.stech.call(action, payload);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
function reset() {
  kioskGames.endSession();
  clearTimeout(showInsufficientBalance.timer);
  $('#balance-warning').hidden = true;
  computerData = undefined; computersError = ''; computerZone = undefined; computerNotice = ''; selectedComputer = undefined; computerStart = undefined; startingComputer = false; state.epoch++; state.quoteVersion++; state.data = null; state.loading = false; state.walletStale = false; state.recentState = ''; state.historyLoading = false; state.page = 'home'; state.history = []; state.historyError = ''; state.payment = null; state.posAttempt = undefined; state.processing = false; state.modal = null; state.pin = ''; state.quote = null; state.promotionId = undefined; state.quoteError = ''; state.amount = '200'; state.filter = 'all'; cardBuffer = '';
  $('#toast').hidden = true; render(); renderModal();
  void refreshPcAvailability();
}
function welcome() {
  return `<div class="welcome"><header>${logo}<div class="header-right">${badge()}<span class="clock">${e(state.clock)}</span></div></header>
    <main class="welcome-main"><div class="welcome-copy"><img class="hero-emblem" src="assets/brand-emblem.png" alt="S TECH E-SPOR 1999 aslan amblemi"><span class="eyebrow"><span class="tiny-line"></span> OYUN BURADA BAŞLAR</span><h1>Hazırsan,<br><span>oyuna devam.</span></h1><p>Bakiyen, avantajların ve hesabın.<br>Hepsi tek dokunuş uzağında.</p>${state.info?.mode === 'connected' ? `<button type="button" class="pc-availability" data-action="open-floor-map" aria-haspopup="dialog" aria-label="Salon haritasını aç" aria-describedby="pc-availability">${icon('monitor')}<span id="pc-availability" role="status">${e(pcAvailability)}</span>${icon('arrow')}</button>` : ''}<div class="welcome-benefits"><span>${icon('topup')}Hızlı yükleme</span><span>${icon('campaigns')}Sana özel fırsatlar</span></div></div>
    <section class="tap-panel"><div class="panel-top"><span>01 / KARTINLA GİRİŞ YAP</span>${icon('shield')}</div><div class="tap-orbit"><div class="tap-ring"></div><div class="tap-ring second"></div><div class="member-card"><div class="member-card-head">S TECH ${icon('nfc')}</div><div class="card-chip"></div><div class="member-card-bottom">PLAYER CARD<span>•••• •••• ••••</span></div></div><span class="tap-symbol">${icon('nfc')}</span></div><h2>${state.loading ? 'Hesabın açılıyor…' : 'Üye kartını okut'}</h2><p>Kartını bilgisayarın yanındaki<br>NFC okuyucuya yaklaştır.</p><div class="reader-status"><i class="${state.loading ? 'pulse' : ''}"></i>${state.loading ? 'Bilgilerin kontrol ediliyor' : 'Kart okutmanı bekliyoruz'}</div>
    ${state.info?.mode === 'demo' ? `<div class="demo-entry"><span>${isDesignPreview() ? 'Hesabını seç' : 'Keşfetmek için bir deneme hesabı seç'}</span>${button((isDesignPreview() ? 'Kaan ' : 'Kaan olarak dene ') + icon('arrow'), 'demo1', 'primary', state.loading)}${button(isDesignPreview() ? 'Deniz' : 'Deniz olarak dene', 'demo2', 'quiet', state.loading)}</div>` : `<div class="password-entry"><span>Kartın yanında değil mi?</span>${button(icon('profile') + ' Kullanıcı adıyla giriş', 'open-password-login', 'secondary wide', state.loading)}</div><div class="secure-note">${icon('shield')} Oturumun işlem sonunda güvenle kapanır.</div>`}</section></main>
    <footer><span>${e(state.info?.station || 'S TECH')} <span class="footer-separator">/</span> MÜŞTERİ NOKTASI</span><span>İyi oyunlar. <span class="orange">İyi ki buradasın.</span></span></footer></div>`;
}
const originalNav = [
  { id: 'computers', label: 'Bilgisayarlar', icon: 'monitor' },
  { id: 'campaigns', label: 'Kampanyalar', icon: 'campaigns' },
  { id: 'topup', label: 'Bakiye yükle', icon: 'topup' },
  { id: 'home', label: 'Ana ekran', icon: 'home' },
  { id: 'history', label: 'İşlem geçmişi', icon: 'history' },
  { id: 'profile', label: 'Profilim', icon: 'profile' },
  { id: 'games', label: 'Oyunlar', icon: 'bolt' },
];
const nav = originalNav;
let campaignRotationTimer;
let campaignPointerId;
function scheduleCampaignRotation() {
  const track = root.querySelector('.home-campaign-track');
  if (window.kioskDesign?.config?.behavior.autoplay === false || !track || track.children.length < 2 || state.modal || document.hidden || campaignPointerId !== undefined) {
    clearTimeout(campaignRotationTimer);
    campaignRotationTimer = undefined;
    return;
  }
  if (campaignRotationTimer !== undefined) return;
  campaignRotationTimer = setTimeout(() => {
    campaignRotationTimer = undefined;
    const current = root.querySelector('.home-campaign-track');
    if (current?.clientWidth && current.children.length > 1) {
      const next = (Math.round(current.scrollLeft / current.clientWidth) + 1) % current.children.length;
      current.scrollTo({ left: next * current.clientWidth,
        behavior: next === 0 || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }
    scheduleCampaignRotation();
  }, 3000);
}

let zoneAdStartedAt;
function render() {
  window.kioskDesign?.navigation(nav, originalNav);
  if (!state.data) { zoneAdStartedAt = undefined; root.innerHTML = welcome(); window.kioskDesign?.apply(root, "welcome"); scheduleCampaignRotation(); return; }
  const campaignOffset = root.querySelector('.home-campaign-track')?.scrollLeft ?? 0;
  const member = state.data.member;
  const title = nav.find(item => item.id === state.page)?.label;
  const zonePickerOpen = state.page === 'computers' && !computerZone;
  zoneAdStartedAt = zonePickerOpen ? zoneAdStartedAt ?? performance.now() : undefined;
  root.innerHTML = `<div class="shell ${state.page === 'topup' && !state.payment ? 'topup-screen' : ''}"><aside>${zonePickerOpen ? '' : logo}<div class="station-label">MÜŞTERİ NOKTASI</div><nav aria-label="Ana menü">${nav.map(n => `<button data-page="${n.id}" class="nav-item ${state.page === n.id ? 'active' : ''}" ${state.page === n.id ? 'aria-current="page"' : ''}>${icon(n.icon)}${e(n.label)}${state.page === n.id ? '<span class="nav-dot"></span>' : ''}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="member-mini"><div class="avatar">${e(member.name.charAt(0))}</div><div><strong>${e(member.name)}</strong><span>${e(member.username)}</span></div></div>${button(icon('logout') + ' Oturumu bitir', 'logout', 'logout-button')}<span class="sidebar-foot">${icon('shield')} Bu bilgisayar ortak kullanımdadır.</span></div></aside><div class="workspace"><header><span class="breadcrumb">S TECH <span>/</span> ${e(title)}</span>${zonePickerOpen ? `<div class="zone-header-brand">${logo}</div>` : ''}<div class="header-right">${badge()}<span class="clock">${e(state.clock)}</span></div></header><main class="content">${state.page === 'home' ? home() : state.page === 'topup' ? topup() : state.page === 'campaigns' ? campaigns() : state.page === 'history' ? history() : state.page === 'computers' ? computersPage() : state.page === 'games' ? kioskGames.render() : state.page === 'profile' ? profile() : ''}</main><footer><span>${icon('shield')} İşlemin bittiğinde oturumunu kapatmayı unutma.</span><button class="session-time" data-action="continue">Hareketsizlik <b id="seconds">${Math.ceil(state.seconds)}</b> sn ${icon('history')}</button></footer></div></div>`;
  window.kioskDesign?.apply(root, state.page);
  const campaignTrack = root.querySelector('.home-campaign-track');
  if (campaignTrack) campaignTrack.scrollLeft = campaignOffset;
  scheduleCampaignRotation();
  if (state.page === 'games') kioskGames.mount();
}
function rows(items) {
  if (!items.length) return '<div class="empty">' + icon('history') + '<h3>Henüz işlem yok</h3><p>Hesap hareketlerin burada görünecek.</p></div>';
  return items.map(t => `<div class="transaction"><div class="transaction-icon ${e(t.kind)}">${icon(t.kind === 'usage' ? 'monitor' : ['bonus', 's_coin', 'game_reward'].includes(t.kind) ? 'bolt' : 'topup')}</div><div class="transaction-description"><strong>${e(t.title)}</strong><span>${date(t.createdAt)}</span></div><div class="transaction-amount ${t.amount > 0 ? 'positive' : ''}"><strong>${t.amount > 0 ? '+' : ''}${t.kind === 's_coin' ? e(t.amount) + ' S Coin' : cash(t.amount)}</strong>${Number.isSafeInteger(t.balanceAfter) ? '<span>Bakiye ' + cash(t.balanceAfter) + '</span>' : ''}</div></div>`).join('');
}
function campaignCard(p) {
  return `<article class="bonus-coupon campaign-ticket ${p.accent === 'blue' ? 'coupon-blue campaign-blue' : ''}"><div class="coupon-value"><strong>%${e(p.bonusPercent)}</strong><span>BONUS</span></div><div class="coupon-body"><span class="eyebrow">S TECH ÜYE KUPONU</span><h3>${e(p.title)}</h3><p class="ticket-description">${e(p.description)}</p><div class="coupon-bottom"><p>Alt limit<strong>${cash(p.minimumAmount)}</strong></p>${button('Kampanyayı incele ' + icon('arrow'), 'campaign:' + e(p.id), 'coupon-apply')}</div><small class="coupon-hint">Son gün: ${new Date(p.endsAt).toLocaleDateString('tr-TR')}</small></div></article>`;
}

function homeCampaigns(promotions) {
  if (!promotions.length) return '<section class="panel no-campaign">' + icon('campaigns') + '<h2>Aktif kampanya yok.</h2></section>';
  return `<section class="home-campaigns" aria-label="Aktif kampanyalar">
    <div class="home-campaign-track" tabindex="0" role="region" aria-label="Kampanya kartları">${promotions.map(campaignCard).join('')}</div>
  </section>`;
}

function home() {
  const d = state.data;
  return `<div class="page-heading"><div><span class="eyebrow">TEKRAR HOŞ GELDİN</span><h1>Merhaba, ${e(d.member.name.split(' ')[0])}<span class="orange">.</span></h1><p>Yeni bir oyun, yeni bir heyecan. Hesabın hazır.</p></div><span class="member-badge">${icon('nfc')} S TECH ÜYESİ</span></div>
  <div class="home-grid"><section class="balance-card"><div class="balance-top"><span>${icon('topup')} KULLANILABİLİR BAKİYEN</span><span class="balance-mark">S /</span></div><div class="balance-value" data-wallet-balance>${balanceText()}</div><div class="balance-caption" data-wallet-caption>${balanceCaption()}</div><div class="balance-bottom">${button('Bakiye yükle ' + icon('plus'), 'go-topup', 'primary')}${state.info.mode === 'connected' && !isDesignPreview() ? button(icon('barcode') + ' Biletler', 'open-ticket-scan', 'secondary ticket-entry') : ''}<span>${icon('shield')} ${state.info.mode === 'demo' ? 'Deneme ortamı' : 'PanCafe bağlantısı'}</span></div><div class="balance-decoration"></div></section>
  ${homeCampaigns(d.promotions)}</div>
  <div class="quick-strip"><div>${icon('nfc')}<span>Kartın yanında,<strong>hesabın elinin altında.</strong></span></div><p>Yükle, avantajları keşfet, oyuna devam et.</p>${button('Hesabımı görüntüle ' + icon('arrow'), 'go-profile', 'quiet')}</div>
  ${(d.pendingPayments || []).length ? `<section class="pending-banner">${icon('history')}<div><strong>Tamamlanmamış işlemin var</strong><span>Kaldığın yerden devam edebilirsin.</span></div>${button('İşlemi aç', 'resume:' + d.pendingPayments[0].id, 'secondary')}</section>` : ''}
  <section class="panel recent"><div class="section-heading"><h2>Son işlemler</h2>${button('Tümünü gör ' + icon('arrow'), 'go-history', 'quiet')}</div><div id="recent-transactions">${recentContent()}</div></section>`;
}
function recentContent() {
  const transactions = state.data.transactions || [];
  if (!transactions.length && state.recentState === 'loading') return '<p class="loading-line">Son işlemler yükleniyor…</p>';
  if (!transactions.length && state.recentState === 'error') return '<p class="loading-line">Son işlemler alınamadı. İşlem geçmişinden tekrar deneyebilirsin.</p>';
  return rows(transactions);
}
function campaignPicker(amount) {
  return '<section class="campaign-picker" aria-label="Kampanya seçimi"><div class="coupon-heading"><h3>Bonus kuponların</h3><span>' + state.data.promotions.length + ' kampanya</span></div>' +
    '<button class="coupon-auto ' + (!state.promotionId ? 'is-selected' : '') + '" data-action="select-promotion:auto" aria-pressed="' + !state.promotionId + '">' + icon('bolt') + '<span>En avantajlı kampanya<small>En yüksek bonusu senin için seçelim</small></span><span class="coupon-radio">' + (!state.promotionId ? '✓' : '') + '</span></button>' +
    '<div class="coupon-list">' + state.data.promotions.map(p => {
      const selected = state.promotionId === p.id;
      const eligible = amount >= p.minimumAmount;
      return '<article class="bonus-coupon ' + (p.accent === 'blue' ? 'coupon-blue ' : '') + (selected ? 'is-selected' : '') + '"><div class="coupon-value"><strong>%' + e(p.bonusPercent) + '</strong><span>BONUS</span></div><div class="coupon-body"><h4>' + e(p.title) + '</h4><div class="coupon-bottom"><p>Alt limit<strong>' + cash(p.minimumAmount) + '</strong></p><button class="coupon-apply" data-action="select-promotion:' + e(p.id) + '" aria-label="' + e(p.title) + (selected ? ' seçildi' : ' uygula') + '" aria-pressed="' + selected + '">' + (selected ? '✓ Seçili' : 'Uygula') + '</button></div><small class="coupon-hint">' + (eligible ? 'En fazla ' + cash(p.maxBonus) + ' bonus' : cash(p.minimumAmount - amount) + ' daha yükleyerek yararlan') + '</small></div></article>';
    }).join('') + '</div></section>';
}
function topup() {
  if (state.payment) return paymentView();
  const pending = state.info.mode === 'connected' ? (state.data.pendingPayments || []) : [];
  if (pending.length) return `<div class="page-heading"><div><h1>Bekleyen ödeme</h1><p>Devam etmek için mevcut ödeme kaydını aç.</p></div></div>
    ${pending.map(payment => `<section class="pending-banner">${icon('history')}<div><strong>${cash(payment.amount)} · ${payment.status === 'transferring' ? 'Ödeme alındı' : 'Ödeme bekliyor'}</strong><span>${date(payment.createdAt)}</span></div>${button('Ödeme kaydını aç', 'resume:' + e(payment.id), 'secondary')}</section>`).join('')}`;
  const amount = Number(state.amount || 0) * 100;
  const q = state.quote;
  return `<div class="page-heading"><div><span class="eyebrow">OYUNA ARA VERME</span><h1>Bir sonraki oyuna hazır ol.</h1><p>Yüklemek istediğin tutarı seç, kartınla öde, devam et.</p></div>
    ${state.info.mode === 'connected' && !isDesignPreview() ? button(icon('barcode') + ' Bilet aktive et', 'open-ticket-scan', 'secondary ticket-entry') : ''}</div>
  ${isDesignPreview() ? '' : state.data.features.odealStage ? '<div class="notice">Ödeal test ortamı · Deneme bakiyesi</div>' : state.info.mode === 'demo' ? '<div class="notice">' + icon('info') + ' Deneme ortamındasın. POS ve bakiye işlemleri temsili olarak çalışır.</div>' : state.data.features.topup ? '' : '<div class="notice">' + icon('info') + ' POS ile yükleme şu anda kapalı.</div>'}
  <div class="topup-grid"><section class="panel amount-panel"><div class="section-heading"><h2>Yükleme tutarı</h2><span>01 / 02</span></div><div class="amount-display"><span>₺</span><strong>${e(state.amount || '0')}</strong><span>TL</span></div><div class="amount-presets">${[100, 200, 500, 1000].map(n => button(`${n} TL`, `amount:${n}`, Number(state.amount) === n ? 'preset selected' : 'preset')).join('')}</div><div class="keypad">${['1','2','3','4','5','6','7','8','9','clear','0','back'].map(k => button(k === 'clear' ? 'Temizle' : k === 'back' ? '⌫' : k, `key:${k}`, k === 'clear' ? 'key key-small' : 'key')).join('')}</div><p class="muted minimum">En az 1 TL · En fazla 10.000 TL</p></section>
  <section class="summary-column"><div class="panel summary"><span class="eyebrow">İŞLEM ÖZETİ</span><h2>Oyunun kesilmesin.</h2>${campaignPicker(amount)}${state.quoteError ? '<p role="alert" class="quote-error">' + e(state.quoteError) + '</p>' : ''}<div class="summary-row"><span>Yüklenecek tutar</span><strong>${cash(amount)}</strong></div><div class="summary-row"><span>Kampanya bonusu</span><strong class="positive">${q ? '+' + cash(q.bonus) : '—'}</strong></div><div class="summary-row s-coin-quote"><span>Kazanılacak S Coin</span><strong>${Number.isSafeInteger(q?.sCoinEarned) ? e(q.sCoinEarned) + ' S Coin' : '—'}</strong></div><div class="summary-total"><span>Hesabına eklenecek</span><strong>${q ? cash(q.total) : '—'}</strong></div>${q?.bonus ? '<div class="bonus-note">' + icon('bolt') + ' Bu yüklemeyle bonus kazanıyorsun.</div>' : '<p class="muted">Geçerli kampanyalar otomatik uygulanır.</p>'}${button('POS ile ödemeye geç ' + icon('arrow'), 'pay', 'primary wide', !q || !state.data.features.topup || state.processing)}<div class="secure-note">${icon('shield')} Kart bilgilerin bu bilgisayarda tutulmaz.</div></div><div class="payment-how"><span>NASIL ÇALIŞIR?</span><p><b>1</b> Yükleme tutarını seç.</p><p><b>2</b> POS cihazındaki adımları izle.</p><p><b>3</b> Bakiye onayını ekranda gör.</p></div></section></div>`;
}
async function checkPosStatus(showError = false) {
  const current = state.payment;
  if (state.info?.mode !== 'connected' || posStatusInFlight || state.processing ||
      !['pending', 'transferring'].includes(current?.status)) return;
  const epoch = state.epoch;
  posStatusInFlight = true;
  try {
    const payment = await call('payment', { id: current.id });
    if (epoch !== state.epoch || state.processing || state.payment !== current) return;
    if (payment.status === current.status && payment.awaitingTerminal === current.awaitingTerminal &&
        payment.transferNeedsReview === current.transferNeedsReview) return;
    state.payment = payment;
    render();
    if (payment.status === 'completed' || payment.status === 'failed') await refresh();
  } catch (error) {
    if (showError && epoch === state.epoch) toast(error.message);
  } finally {
    posStatusInFlight = false;
  }
}
setInterval(() => void checkPosStatus(), 3000);
function paymentView() {
  const p = state.payment, done = p.status === 'completed', failed = p.status === 'failed';
  const physical = state.info.mode === 'connected';
  const transferring = p.status === 'transferring';
  const review = transferring && p.transferNeedsReview;
  const waiting = physical && p.awaitingTerminal === false;
  const cancel = physical && p.status === 'pending' && p.awaitingTerminal === true
    ? button('Ödemeyi iptal et', 'pos-cancel', 'secondary', state.processing)
    : '';
  const title = done ? 'Hazırsın. İyi oyunlar!' : failed ? 'Ödeme tamamlanmadı.' : review ? 'Ödeme alındı, aktarım inceleme bekliyor.' : transferring ? 'Bakiye yükleniyor…' : waiting ? 'POS işlemi kontrol ediliyor…' : 'Kartını POS cihazına okut.';
  const detail = done ? (isDesignPreview() ? 'Yüklemen ve bonusun hesabına eklendi.' : p.simulation || !physical ? 'Yüklemen ve bonusun deneme hesabına eklendi.' : 'Yüklemen ve bonusun PanCafe hesabına eklendi.') : failed ? 'Bu işlem için bakiye eklenmedi.' : review ? 'Alınan ödemenin bakiyeye aktarımını tekrar deneyebilirsin.' : transferring ? 'Ödeme alındı. Bakiyen doğrulandığında burada görünecek.' : waiting ? 'Tutar POS ekranında görünmüyorsa yetkiliye başvur.' : 'POS cihazındaki yönlendirmeleri takip et.<br>Ödeme sonucu burada görünecek.';
  return `<div class="payment-page">${!state.processing && !done && (!physical || failed) ? button(icon('back') + ' Tutara geri dön', 'payment-back', 'quiet') : ''}<div class="payment-steps"><span class="finished">1 <b>Tutar seçimi</b></span><i></i><span class="${done ? 'finished' : 'current'}">2 <b>POS ile ödeme</b></span><i></i><span class="${done ? 'finished' : ''}">3 <b>Bakiye onayı</b></span></div><section class="panel payment-panel"><div class="payment-illustration ${done ? 'success' : failed ? 'failure' : ''}">${icon(done ? 'check' : failed ? 'close' : 'topup')}</div><span class="eyebrow">${done ? 'İŞLEM TAMAMLANDI' : failed ? 'ÖDEME ONAYLANMADI' : 'POS İLE ÖDEME'}</span><h1>${title}</h1><p>${detail}</p><div class="payment-value">${cash(p.amount)}</div><div class="payment-receipt"><span>Yükleme <b>${cash(p.amount)}</b></span><span>Bonus <b class="positive">+${cash(p.bonus)}</b></span>${done ? '<span>Yeni bakiye <b>' + cash(p.balanceAfter) + '</b></span>' : ''}</div>
  ${done ? '<div class="completion-choice"><h2>Başka bir işlem yapmak ister misin?</h2><div class="completion-actions">' + button('Başka bir işlem yap ' + icon('arrow'), 'another-transaction', 'secondary', state.processing) + button('İşlemleri bitir ' + icon('check'), 'finish-session', 'primary') + '</div></div>' : failed ? button('Yeni işlem başlat', 'payment-back', 'primary') : physical ? '<div class="completion-actions">' + (review ? button(state.processing ? 'Aktarım deneniyor…' : 'Tekrar dene', 'pos-retry', 'primary', state.processing) : button('Durumu kontrol et', 'pos-status', 'secondary', state.processing)) + cancel + (isDesignPreview() && p.status === 'pending' ? button('Ödemeyi onayla', 'approve', 'primary', state.processing) + button('Ödemeyi reddet', 'decline', 'secondary', state.processing) : '') + '</div>' : `<div class="pos-demo">${isDesignPreview() ? '' : '<span>DENEME POS KONTROLLERİ · GERÇEK TAHSİLAT YOK</span>'}<div>${button(icon('check') + ' Ödemeyi onayla', 'approve', 'primary', state.processing)}${button('Ödemeyi reddet', 'decline', 'secondary', state.processing)}</div></div>`}
  <div class="receipt-id">İşlem no: ${e(p.id)}</div></section></div>`;
}
function campaigns() {
  return `<div class="page-heading"><div><span class="eyebrow">DAHA FAZLA OYUN, DAHA FAZLA AVANTAJ</span><h1>Oyunun avantajlı hali.</h1><p>Geçerli fırsatları keşfet. Yüklemenden daha fazlasını al.</p></div></div><div class="campaign-grid">${state.data.promotions.length ? state.data.promotions.map(campaignCard).join('') : '<div class="panel empty">' + icon('campaigns') + '<h2>Şu an aktif kampanya yok.</h2><p>Yeni fırsatlar bu alanda görünecek.</p></div>'}</div><div class="notice neutral">${icon('info')} Bonuslar yükleme sırasında otomatik hesaplanır. Kampanya koşullarını inceleyebilirsin.</div>`;
}
const historyFilters = [['all','Tümü'], ['topup','Yüklemeler'], ['bonus','Bonus TL'], ['s_coin','S Coin'], ['game_reward','Oyun ödülleri']];
function history() {
  const filtered = state.history.filter(item => state.filter === 'all' || state.filter === item.kind);
  const content = state.historyLoading ? '<p class="loading-line" role="status">İşlemler yükleniyor…</p>'
    : state.historyError ? '<p class="notice" role="alert">' + e(state.historyError) + '</p>' : rows(filtered);
  return `<div class="page-heading"><div><h1>İşlem geçmişi</h1><p>Her kategorideki son 10 kayıt.</p></div>${button('Yenile', 'history-refresh', 'secondary', state.historyLoading)}</div>
    <div class="filter-bar">${historyFilters.map(([id,label]) => `<button class="filter ${state.filter === id ? 'selected' : ''}" data-action="filter:${id}" aria-pressed="${state.filter === id}">${label}</button>`).join('')}</div><section class="panel history-panel">${content}</section>`;
}

function profile() {
  const m = state.data.member;
  return `<div class="page-heading"><div><span class="eyebrow">S TECH HESABIN</span><h1>Seni tanımak güzel.</h1><p>Üyelik bilgilerin ve hesabınla ilgili her şey.</p></div></div><div class="profile-grid"><section class="panel profile-card"><div class="avatar large">${e(m.name.charAt(0))}</div><h2>${e(m.name)}</h2><span class="muted">@${e(m.username)}</span><span class="member-badge">${icon('nfc')} S TECH ÜYESİ</span><div class="profile-balance"><span>Kullanılabilir bakiye</span><strong data-wallet-balance>${balanceText()}</strong></div></section><section class="panel profile-details"><h2>Hesap bilgilerim</h2>${[['Üye no',m.memberNumber || '—'],['Ad soyad',m.name],['Kullanıcı adı',m.username],['Telefon',m.phone || 'Belirtilmemiş'],['E-posta',m.email || 'Belirtilmemiş'],['Üyelik tarihi',new Date(m.joinedAt).toLocaleDateString('tr-TR')]].map(([label,value]) => `<div class="summary-row"><span>${label}</span><strong>${e(value)}</strong></div>`).join('')}<div class="notice neutral">${icon('info')} Bilgilerini güncellemek veya kartınla ilgili destek almak için S TECH yetkilisine başvurabilirsin.</div></section></div><section class="privacy-strip">${icon('shield')}<div><strong>Hesabın sana özel.</strong><p>İşin bittiğinde oturumunu kapat. Bir sonraki müşteri bilgilerini göremez.</p></div>${button('Oturumu bitir ' + icon('logout'), 'logout', 'secondary')}</section>`;
}
let loginFormTimer;
let loginField = 'username', loginSymbols = false, loginUppercase = false;
const loginLetterRows = ['1234567890', 'qwertyuıopğü', 'asdfghjklşi', 'zxcvbnmöç'];
const loginSymbolRows = ['!@#$%^&*()', '-_=+[]{}\\|', ";:'\",.<>/?`~"];
function loginKeyboard() {
  const rows = loginSymbols ? loginSymbolRows : loginLetterRows;
  const key = char => {
    const value = loginUppercase && !loginSymbols ? char.toLocaleUpperCase('tr-TR') : char;
    return `<button type="button" class="touch-key" data-login-key="${e(value)}">${e(value)}</button>`;
  };
  return `${rows.map(row => `<div class="login-key-row">${Array.from(row, key).join('')}</div>`).join('')}
    <div class="login-key-row login-key-actions">
      <button type="button" class="touch-key" data-login-action="shift" aria-pressed="${loginUppercase}">Büyük harf</button>
      <button type="button" class="touch-key" data-login-action="layout">${loginSymbols ? 'Harfler' : 'Semboller'}</button>
      <button type="button" class="touch-key" data-login-key=" ">Boşluk</button>
      <button type="button" class="touch-key" data-login-action="back">⌫ Sil</button>
      <button type="button" class="touch-key" data-login-action="next">Sonraki</button>
    </div>`;
}
function typeLoginKey(key) {
  const form = $('#password-login-form');
  if (!form || state.loading) return;
  const input = form.elements.namedItem(loginField);
  const command = key.dataset.loginAction;
  if (command === 'shift' || command === 'layout') {
    if (command === 'shift') { loginUppercase = !loginUppercase; loginSymbols = false; }
    else loginSymbols = !loginSymbols;
    form.querySelector('.login-keyboard').innerHTML = loginKeyboard();
    input.focus();
    return;
  }
  if (command === 'next') {
    if (loginField === 'username') form.elements.password.focus();
    else form.requestSubmit();
    return;
  }
  let start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const value = key.dataset.loginKey ?? '';
  if (command === 'back' && start === end) start -= Array.from(input.value.slice(0, start)).at(-1)?.length ?? 0;
  if (input.value.length - (end - start) + value.length <= input.maxLength)
    input.setRangeText(value, start, end, 'end');
  input.focus();
}
function resetLoginFormTimer() {
  clearTimeout(loginFormTimer);
  loginFormTimer = setTimeout(() => {
    if (state.modal === 'password-login' && !state.loading) void action('close-modal');
  }, 90000);
}
function renderModal() {
  scheduleCampaignRotation();
  const host = $('#modal-root');
  clearTimeout(loginFormTimer);
  root.inert = ['password-login', 'floor-map', 'ticket-scan'].includes(state.modal);
  if (!state.modal) { host.innerHTML = ''; return; }
  let content;
  if (state.modal === 'password-login') {
    content = `<div class="modal-symbol">${icon('profile')}</div><h2 id="password-login-title">Kullanıcı adıyla giriş</h2>
      <p>PanCafe hesabının kullanıcı adını ve şifresini gir.</p>
      <form id="password-login-form" class="password-login-form" autocomplete="off">
        <fieldset>
          <div class="login-fields">
            <label>Kullanıcı adı<input name="username" maxlength="120" inputmode="none" autocapitalize="none" spellcheck="false" required></label>
            <label>Şifre<input name="password" type="password" maxlength="256" inputmode="none" required></label>
            <p class="login-error" role="alert" hidden></p>
          </div>
          <div class="login-keyboard" role="group" aria-label="Ekran klavyesi">${loginKeyboard()}</div>
          <div class="login-form-actions">
            <button type="submit" class="button primary wide">Giriş yap ${icon('arrow')}</button>
            <button type="button" class="button quiet wide" data-action="close-modal">Kartla girişe dön</button>
          </div>
        </fieldset>
      </form>`;
    resetLoginFormTimer();
  } else if (state.modal === 'idle') content = `<div class="modal-symbol">${icon('history')}</div><h2>Hâlâ burada mısın?</h2><p>Gizliliğin için oturumun <b id="idle-seconds">${Math.ceil(state.seconds)}</b> saniye sonra kapanacak.</p>${button('Buradayım, devam et', 'continue', 'primary wide')}${button('Oturumu bitir', 'confirm-logout', 'quiet wide')}`;
  else if (state.modal === 'logout') content = `<div class="modal-symbol">${icon('logout')}</div><h2>İşlemlerin tamam mı?</h2><p>Oturumun kapanacak ve ekran yeni müşteri için hazırlanacak.</p>${button('Evet, oturumu bitir', 'confirm-logout', 'primary wide')}${button('Hesabıma dön', 'close-modal', 'secondary wide')}`;
  else if (state.modal === 'admin') content = `<span class="eyebrow">YETKİLİ ERİŞİMİ</span><h2>Kiosku kapat</h2><p>Yetkili PIN kodunu gir.${state.info?.mode === 'demo' && !isDesignPreview() ? ' Deneme PIN: 2026.' : ''}</p><input class="pin-input" type="password" value="${e(state.pin)}" maxlength="16" inputmode="numeric" autocomplete="off" aria-label="Yetkili PIN kodu"><div class="keypad admin-keypad">${['1','2','3','4','5','6','7','8','9','clear','0','back'].map(k => button(k === 'clear' ? 'Sil' : k === 'back' ? '⌫' : k, 'pin:' + k, 'key')).join('')}</div>${button('Uygulamayı kapat', 'admin-exit', 'primary wide')}${button('Geri dön', 'close-modal', 'quiet wide')}`;
  else if (state.modal === 'computer-start' && selectedComputer) {
    content = `<div class="modal-symbol">${icon('monitor')}</div><h2>${e(selectedComputer.name)} açılsın mı?</h2><p>Oturum ${e(state.data.member.username)} üyeliğinle başlayacak. PanCafe’deki üye tarifesi ve varsa açılış ücreti uygulanır.</p>${button('Oturumu başlat', 'computer-confirm', 'primary wide')}${button('Vazgeç', 'close-modal', 'secondary wide')}`;
  } else if (state.modal === 'computer-progress' && computerStart) {
    content = `<div class="modal-symbol">${icon('monitor')}</div><h2 id="computer-progress-title">${computerProgressTitle(computerStart)}</h2>
      <p role="status">${e(computerStart.name)} · PanCafe bağlantısı kontrol ediliyor.</p>
      ${button('Oturumu bitir', 'computer-finish', 'secondary wide', !computerStart.accepted)}
      ${button('İşleme devam et', 'computer-continue', 'primary wide')}`;
  } else if (state.modal === 'floor-map') {
    content = `<div class="floor-map-heading"><h2 id="floor-map-title">Salon haritası</h2>
      <div class="map-legend"><span><i class="pc-free"></i>Kullanılabilir</span><span><i class="pc-busy"></i>Dolu veya ayrılmış</span><span><i></i>Kullanılamıyor</span></div>
      ${button('Kapat', 'close-modal', 'secondary')}</div>
      <p id="floor-map-status" role="status">Bilgisayar durumu alınıyor…</p>
      <div id="floor-map-content">${floorMapGallery([])}</div>`;
  } else if (state.modal === 'ticket-scan') {
    content = `<div class="ticket-scan-heading"><h2 id="ticket-scan-title">Biletler</h2>${button('Kapat', 'close-modal', 'secondary')}</div>
      <div class="ticket-scan-card">
        <div class="ticket-scan-symbol">${icon('barcode')}</div>
        <h3>Biletini okut</h3>
        <p>Biletin üzerindeki barkodu ekranın altındaki okuyucuya göster.</p>
        <form id="ticket-scan-form" autocomplete="off">
          <label for="ticket-barcode">Barkod</label>
          <input id="ticket-barcode" type="password" inputmode="none" maxlength="256" autocomplete="off" aria-describedby="ticket-scan-status">
        </form>
        <p class="ticket-scan-status" id="ticket-scan-status" role="status">Barkod bekleniyor…</p>
      </div>`;
  } else {
    const p = state.data?.promotions.find(p => p.id === state.modal);
    if (!p) { state.modal = null; host.innerHTML = ''; return; }
    content = `<span class="eyebrow">KAMPANYA DETAYI</span><h2>${e(p.title)}</h2><p>${e(p.description)}</p><div class="campaign-terms"><strong>Kampanya koşulları</strong><p>${e(p.terms)}</p><p>Minimum yükleme: <strong>${cash(p.minimumAmount)}</strong><br>Bonus: <strong>%${e(p.bonusPercent)}</strong><br>En fazla bonus: <strong>${cash(p.maxBonus)}</strong></p><span>${date(p.startsAt)} – ${date(p.endsAt)}</span></div>${button('Bakiye yükle ' + icon('arrow'), 'modal-topup', 'primary wide')}${button('Geri dön', 'close-modal', 'quiet wide')}`;
  }
  const label = state.modal === 'password-login' ? 'aria-labelledby="password-login-title"'
    : state.modal === 'computer-progress' ? 'aria-labelledby="computer-progress-title"'
    : state.modal === 'floor-map' ? 'aria-labelledby="floor-map-title"'
    : state.modal === 'ticket-scan' ? 'aria-labelledby="ticket-scan-title"'
    : state.modal === 'admin' ? 'aria-label="Yetkili erişimi"' : 'aria-label="Bilgilendirme"';
  const modalStyles = new Map([['password-login', 'password-modal'], ['floor-map', 'floor-map-modal'], ['ticket-scan', 'ticket-scan-modal']]);
  host.innerHTML = `<div class="modal-backdrop"><section class="modal ${modalStyles.get(state.modal) ?? ''}" role="dialog" aria-modal="true" ${label}>${content}</section></div>`;
  (host.querySelector('#ticket-barcode') ?? host.querySelector('input, button'))?.focus();
}
async function completeTicketScan(input) {
  if (input.disabled) return;
  const barcode = input.value.trim();
  input.value = '';
  input.focus();
  if (!barcode) return;
  const status = $('#ticket-scan-status');
  if (!state.data) return;
  if (!/^[0-9]{10}$/.test(barcode)) {
    status.textContent = 'Bilet barkodu 10 rakam olmalı. Tekrar okut.';
    return;
  }
  const closeButton = $('.ticket-scan-heading button');
  input.disabled = true;
  closeButton.disabled = true;
  status.textContent = 'Bilet PanCafe’de kontrol ediliyor…';
  try {
    const result = await call('redeemTicket', { barcode });
    if (!input.isConnected) return;
    if (result.status === 'ok') {
      status.dataset.scanned = 'true';
      status.textContent = `${cash(result.amount)} bakiyene eklendi.`;
      await refreshLiveAccount();
    } else {
      status.textContent = result.message || 'Bilet işlemi henüz doğrulanamadı. Aynı bileti tekrar okut.';
    }
  } catch (error) {
    if (input.isConnected) status.textContent = error.message;
  } finally {
    input.disabled = false;
    closeButton.disabled = false;
    if (input.isConnected) input.focus();
  }
}
async function scan(uid) {
  if (state.data || state.loading || state.modal) return;
  const epoch = state.epoch; state.loading = true; render();
  try { const data = await call('scan', { uid }); if (epoch !== state.epoch) return; openHome(data); }
  catch (error) { if (epoch === state.epoch) toast(error.message); }
  finally { if (epoch === state.epoch) { state.loading = false; render(); } }
}
async function submitPasswordLogin(form) {
  if (state.loading || state.data || state.modal !== 'password-login') return;
  const username = form.elements.username;
  const password = form.elements.password;
  if (!username.value.trim()) { username.focus(); return; }
  const epoch = state.epoch;
  const fields = form.querySelector('fieldset');
  const submit = form.querySelector('[type="submit"]');
  const errorMessage = form.querySelector('.login-error');
  state.loading = true;
  fields.disabled = true;
  submit.textContent = 'Hesabın açılıyor…';
  errorMessage.hidden = true;
  const request = call('passwordLogin', { username: username.value, password: password.value });
  password.value = '';
  try {
    const data = await request;
    if (epoch !== state.epoch) return;
    state.modal = null;
    renderModal();
    openHome(data);
  } catch (error) {
    if (epoch !== state.epoch) return;
    fields.disabled = false;
    submit.textContent = 'Giriş yap';
    errorMessage.hidden = false;
    errorMessage.textContent = error.message;
    password.focus();
    resetLoginFormTimer();
  } finally {
    if (epoch === state.epoch) state.loading = false;
  }
}
function openHome(data) {
  kioskGames.startSession(state.info.mode === 'connected' ? async (game, operationId) => {
    const epoch = state.epoch;
    const version = ++sCoinVersion;
    const result = await call('sCoinPlay', { game, operationId });
    if (epoch === state.epoch && version === sCoinVersion) {
      if (result.balance) showSCoinBalance(result.balance);
      else void refreshSCoin();
    }
    return result;
  } : undefined, isDesignPreview());
  state.data = data;
  state.seconds = 90;
  state.page = 'home';
  state.walletStale = false;
  state.recentState = state.info.mode === 'connected' ? 'loading' : '';
  render();
  void loadRecent();
}
let recentEpoch;
async function loadRecent() {
  const epoch = state.epoch;
  if (!state.data || state.info.mode !== 'connected' || recentEpoch === epoch) return;
  recentEpoch = epoch;
  try {
    const { items } = await call('transactions');
    if (epoch !== state.epoch || !state.data) return;
    state.data.transactions = items.slice(0, 5);
    state.recentState = 'ready';
  } catch {
    if (epoch === state.epoch) state.recentState = 'error';
  } finally {
    if (recentEpoch === epoch) recentEpoch = undefined;
    const list = $('#recent-transactions');
    if (epoch === state.epoch && state.data && list) list.innerHTML = recentContent();
  }
}
let walletEpoch;
let posStatusInFlight = false;
async function refreshLiveAccount() {
  const epoch = state.epoch;
  if (!state.data || walletEpoch === epoch) return;
  walletEpoch = epoch;
  try {
    const { member, wallet, promotions, pendingPayments, features } = await call('dashboard');
    if (epoch !== state.epoch || !state.data) return;
    if (!Number.isSafeInteger(wallet?.balance)) throw new Error('PanCafe bakiyesi doğrulanamadı.');
    const balanceChanged = state.data.wallet?.balance !== wallet.balance;
    const memberChanged = JSON.stringify(state.data.member) !== JSON.stringify(member);
    const promotionsChanged = Array.isArray(promotions) && JSON.stringify(state.data.promotions) !== JSON.stringify(promotions);
    if (Array.isArray(promotions)) state.data.promotions = promotions;
    const posChanged = features?.odealPos === true && (JSON.stringify(state.data.pendingPayments) !== JSON.stringify(pendingPayments) || state.data.features.topup !== features.topup);
    if (features?.odealPos === true) {
      state.data.pendingPayments = pendingPayments;
      state.data.features = features;
    }
    state.data.member = member;
    state.data.wallet = wallet;
    state.walletStale = false;
    if ((memberChanged || promotionsChanged || posChanged) && !state.modal && !state.processing && !state.payment) render();
    if (promotionsChanged && state.page === 'topup' && !state.payment) void updateQuote();
    if (promotionsChanged && state.modal && !['idle', 'logout', 'admin', 'password-login', 'computer-progress', 'ticket-scan'].includes(state.modal)) { render(); renderModal(); }
    if (state.page === 'home' && (balanceChanged || state.recentState === 'error')) void loadRecent();
  } catch {
    if (epoch === state.epoch) state.walletStale = true;
  } finally {
    if (walletEpoch === epoch) walletEpoch = undefined;
    if (epoch === state.epoch && state.data) {
      document.querySelectorAll('[data-wallet-balance]').forEach(element => { element.textContent = balanceText(); });
      const caption = $('[data-wallet-caption]');
      if (caption) caption.textContent = balanceCaption();
    }
  }
}
async function refresh() {
  const epoch = state.epoch;
  const data = await call('dashboard');
  if (epoch === state.epoch && state.data) { state.data = data; render(); }
}
async function loadHistory() {
  if (state.historyLoading) return;
  const epoch = state.epoch;
  state.historyLoading = true;
  state.historyError = '';
  render();
  try {
    const data = await call('history');
    if (epoch === state.epoch) state.history = data.items;
  } catch (error) {
    if (epoch === state.epoch) state.historyError = error.message;
  } finally {
    if (epoch === state.epoch) {
      state.historyLoading = false;
      if (state.page === 'history') render();
    }
  }
}

async function updateQuote() {
  const version = ++state.quoteVersion, epoch = state.epoch;
  state.quote = null; state.quoteError = ''; render();
  const amount = Number(state.amount || 0) * 100;
  if (amount < 100 || amount > 1000000) return;
  try { const q = await call('quote', { amount, promotionId: state.promotionId });
  if (version === state.quoteVersion && epoch === state.epoch) { state.quote = q; render(); }
  } catch (error) { if (version === state.quoteVersion && epoch === state.epoch) { state.quoteError = error.message; render(); } }
}
async function go(page) {
  if (state.processing) return;
  if (state.payment?.status === 'completed') { toast('Devam etmek için “Başka bir işlem yap” seçeneğine dokun.'); return; }
  if (['pending', 'transferring'].includes(state.payment?.status)) { toast(state.info.mode === 'connected' ? 'Önce POS işleminin sonucunu bekle.' : 'Önce ödeme ekranındaki işlemi tamamla veya tutara geri dön.'); return; }
  if (page === 'computers') { if (!computerStart) { computerZone = undefined; selectedComputer = undefined; } computerNotice = ''; void loadComputers(); }
  state.page = page; state.payment = null; state.modal = null; renderModal(); render();
  if (state.info.mode === 'connected' && (page === 'home' || page === 'profile')) {
    void refreshLiveAccount();
    if (page === 'home') void loadRecent();
  }
  if (page === 'history') await loadHistory();
  if (page === 'topup') await updateQuote();
  if (page === 'games' && state.info.mode === 'connected') void refreshSCoin();
}
let sCoinEpoch;
let sCoinVersion = 0;
function showSCoinBalance({ units, unitsPerCoin, testOnly, playableCoins }) {
  if (!Number.isSafeInteger(units) || units < 0 || unitsPerCoin !== 10000) {
    kioskGames.showSCoin('S Coin bakiyesi şu anda alınamıyor.');
    return;
  }
  const value = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 4 }).format(units / unitsPerCoin);
  kioskGames.showSCoin(`${testOnly ? 'Test S Coin' : 'S Coin'} · ${value}`, playableCoins);
}
async function refreshSCoin() {
  const epoch = state.epoch;
  if (sCoinEpoch === epoch) return;
  sCoinEpoch = epoch;
  const version = ++sCoinVersion;
  try {
    const balance = await call('sCoin');
    if (epoch === state.epoch && version === sCoinVersion) showSCoinBalance(balance);
  } catch {
    if (epoch === state.epoch && version === sCoinVersion) kioskGames.showSCoin('S Coin bakiyesi şu anda alınamıyor.');
  } finally {
    if (sCoinEpoch === epoch) sCoinEpoch = undefined;
  }
}
async function action(value) {
  const [name, arg] = value.split(':');
  if (name === 'open-ticket-scan') {
    if (!state.data || state.info.mode !== 'connected' || state.processing || state.modal) return;
    cardBuffer = '';
    state.modal = 'ticket-scan';
    renderModal();
    return;
  }
  if (name === 'open-floor-map') {
    if (state.data || state.loading || state.modal || state.info?.mode !== 'connected') return;
    cardBuffer = '';
    state.modal = 'floor-map';
    renderModal();
    void refreshFloorAvailability();
    return;
  }
  if (name === 'open-password-login') {
    if (state.data || state.loading || state.info?.mode !== 'connected') return;
    cardBuffer = '';
    loginField = 'username'; loginSymbols = false; loginUppercase = false;
    state.modal = 'password-login';
    renderModal();
    return;
  }
  if (name === 'demo1' || name === 'demo2') return scan(name === 'demo1' ? 'DEMO0001' : 'DEMO0002');
  if (name === 'computer-continue') {
    if (state.modal === 'computer-progress') { state.modal = null; renderModal(); }
    return;
  }
  if (name === 'computer-finish') {
    if (state.modal !== 'computer-progress' || !computerStart?.accepted) return;
    return action('finish-session');
  }
  if (name === 'finish-session' || name === 'confirm-logout' || (name === 'logout' && state.payment?.status === 'completed')) {
    reset();
    await call('logout');
    return;
  }
  if (name === 'another-transaction') {
    if (state.processing) return;
    const epoch = state.epoch; state.processing = true; render();
    try {
      const result = await call('continueSession');
      if (epoch !== state.epoch) return;
      state.seconds = result.remaining; state.payment = null; state.page = 'home'; state.modal = null; renderModal(); await refresh();
    } finally { if (epoch === state.epoch) { state.processing = false; render(); } }
    return;
  }
  if (name === 'logout') { state.modal = 'logout'; renderModal(); return; }
  if (name === 'continue') {
    if (confirmingEpoch === state.epoch) return;
    const epoch = state.epoch;
    confirmingEpoch = epoch;
    try {
      const countdown = await call('keepAlive');
      if (epoch !== state.epoch) return;
      if (state.modal === 'idle') { state.modal = null; renderModal(); }
      showCountdown(countdown);
    } finally { if (confirmingEpoch === epoch) confirmingEpoch = undefined; }
    return;
  }
  if (name === 'close-modal') {
    const wasLogin = state.modal === 'password-login';
    const wasFloorMap = state.modal === 'floor-map';
    const wasTicketScan = state.modal === 'ticket-scan';
    if (wasLogin && state.loading) return;
    if (wasTicketScan && $('#ticket-barcode')?.disabled) return;
    state.modal = null;
    state.pin = '';
    renderModal();
    if (wasLogin) $('[data-action="open-password-login"]')?.focus();
    if (wasFloorMap) $('[data-action="open-floor-map"]')?.focus();
    if (wasTicketScan) $('[data-action="open-ticket-scan"]')?.focus();
    return;
  }
  if (name === 'computer-zone') { if (computerStart) return; computerZone = arg; selectedComputer = undefined; computerNotice = ''; render(); return; }
  if (name === 'computer-zones') { if (computerStart) return; computerZone = undefined; selectedComputer = undefined; computerNotice = ''; render(); return; }
  if (name === 'computer-clear') { if (computerStart) return; selectedComputer = undefined; render(); return; }
  if (name === 'computer-select') {
    if (computerStart || !computerData) return;
    const pc = computerData.computers.find(pc => pc.id === arg && pc.available);
    if (!pc) return;
    if (!computerData.startSupported || !(pc.canStart ?? pc.virtual)) { selectedComputer = undefined; computerNotice = `${pc.name} kiosktan açılamıyor. Oturum için kasaya başvur.`; render(); return; }
    selectedComputer = pc; computerNotice = ''; render(); return;
  }
  if (name === 'computer-confirm') return startSelectedComputer();
  if (name === 'campaign') { state.modal = arg; renderModal(); return; }
  if (name === 'modal-topup') { state.promotionId = state.modal; return go('topup'); }
  if (name === 'select-promotion') { state.promotionId = arg === 'auto' ? undefined : arg; return updateQuote(); }
  if (name.startsWith('go-')) return go(name.slice(3));
  if (name === 'filter') { state.filter = arg; render(); return; }
  if (name === 'history-refresh') return loadHistory();
  if (name === 'amount') { state.amount = arg; return updateQuote(); }
  if (name === 'key') {
    state.amount = arg === 'clear' ? '' : arg === 'back' ? state.amount.slice(0,-1) : (state.amount === '0' ? arg : (state.amount + arg).slice(0,5));
    return updateQuote();
  }
  if (name === 'pos-status') return checkPosStatus(true);
  if (name === 'pos-retry') {
    const current = state.payment;
    if (state.processing || current?.status !== 'transferring' || !current.transferNeedsReview) return;
    const epoch = state.epoch;
    state.processing = true; render();
    try {
      const payment = await call('retry-payment', { id: current.id });
      if (epoch !== state.epoch) return;
      state.payment = payment;
      if (payment.transferNeedsReview) toast('Aktarım henüz tamamlanmadı. Tekrar deneyebilir veya kasadan kontrol ettirebilirsin.');
      if (payment.status === 'completed' || payment.status === 'failed') await refresh();
    } finally {
      if (epoch === state.epoch) { state.processing = false; render(); }
    }
    return;
  }
  if (name === 'pos-cancel') {
    const current = state.payment;
    if (state.processing || current?.status !== 'pending' || !current.awaitingTerminal) return;
    const epoch = state.epoch;
    toast("pos cihazında da iptal'e basın");
    state.processing = true; render();
    try {
      const payment = await call('cancel-payment', { id: current.id });
      if (epoch !== state.epoch) return;
      state.payment = payment;
      await refresh();
    } finally {
      if (epoch === state.epoch) { state.processing = false; render(); }
    }
    return;
  }
  if (name === 'pay') {
    if (state.processing || !state.quote || !state.data.features.topup) return;
    if (state.info.mode === 'connected' && state.data.pendingPayments?.length) return action('resume:' + state.data.pendingPayments[0].id);
    const epoch = state.epoch; state.processing = true; render();
    const amount = Number(state.amount) * 100;
    const promotionId = state.promotionId;
    const attempt = state.posAttempt;
    const key = attempt?.amount === amount && attempt.promotionId === promotionId ? attempt.key : crypto.randomUUID();
    state.posAttempt = { amount, promotionId, key };
    try {
      const payment = await call('create', { amount, key, promotionId });
      if (epoch !== state.epoch) return;
      state.posAttempt = undefined;
      state.payment = payment;
    }
    finally { if (epoch === state.epoch) { state.processing = false; render(); } }
    return;
  }
  if (name === 'resume') { const epoch = state.epoch; const payment = await call('payment', { id: arg }); if (epoch !== state.epoch) return; state.payment = payment; state.page = 'topup'; render(); return; }
  if ((name === 'approve' || name === 'decline') && (state.info.mode === 'demo' || isDesignPreview())) {
    if (state.processing || !state.payment || state.payment.status !== 'pending') return;
    const epoch = state.epoch; state.processing = true; render();
    try { const payment = await call(isDesignPreview() ? 'preview-payment' : 'settle', { id: state.payment.id, outcome: name === 'approve' ? 'approved' : 'declined' }); if (epoch !== state.epoch) return; state.payment = payment; await refresh(); }
    finally { if (epoch === state.epoch) { state.processing = false; render(); } }
    return;
  }
  if (name === 'payment-back' && state.payment?.status !== 'completed' && (state.info.mode === 'demo' || state.payment?.status === 'failed')) { state.payment = null; return updateQuote(); }
  if (name === 'pin') { state.pin = arg === 'clear' ? '' : arg === 'back' ? state.pin.slice(0,-1) : (state.pin + arg).slice(0,16); renderModal(); return; }
  if (name === 'admin-exit') { await call('adminExit', { pin: state.pin }); return; }
}
document.addEventListener('click', event => {
  const target = event.target.closest('button, .iso-station[data-action], .iso-number[data-action]');
  if (state.modal === 'ticket-scan' && !target) $('#ticket-barcode')?.focus();
  if (!target || target.disabled) return;
  if (target.matches('[data-login-key], [data-login-action]')) { typeLoginKey(target); return; }
  const epoch = state.epoch;
  const task = target.dataset.page ? go(target.dataset.page) : target.dataset.action ? action(target.dataset.action) : null;
  Promise.resolve(task).catch(error => { if (epoch === state.epoch) toast(error.message); });
});
document.addEventListener('keydown', event => {
  if (state.modal || event.repeat || !['Enter', ' '].includes(event.key)) return;
  const station = event.target.closest('.iso-station[data-action]');
  if (!station) return;
  event.preventDefault();
  const selector = '.iso-station[data-action="' + CSS.escape(station.dataset.action) + '"]';
  station.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  root.querySelector(selector)?.focus({ preventScroll: true });
});
document.addEventListener('focusin', event => {
  if (event.target.matches('#password-login-form input')) loginField = event.target.name;
});
document.addEventListener('pointerdown', event => {
  if (event.target.closest('.login-keyboard button')) event.preventDefault();
});
document.addEventListener('input', event => {
  if (event.target.matches('.pin-input')) state.pin = event.target.value;
  if (event.target.id === 'ticket-barcode') {
    const status = $('#ticket-scan-status');
    if (status.dataset.scanned) {
      delete status.dataset.scanned;
      status.textContent = 'Barkod bekleniyor…';
    }
  }
});
document.addEventListener('submit', event => {
  if (event.target.id === 'ticket-scan-form') {
    event.preventDefault();
    void completeTicketScan($('#ticket-barcode'));
    return;
  }
  if (event.target.id !== 'password-login-form') return;
  event.preventDefault();
  void submitPasswordLogin(event.target);
});
let lastActivity = 0;
for (const event of ['pointerdown', 'keydown', 'wheel']) document.addEventListener(event, () => {
  if (state.modal === 'password-login' && !state.loading) resetLoginFormTimer();
  if (state.data && state.modal !== 'idle' && Date.now() - lastActivity > 1000) { lastActivity = Date.now(); void call('activity').then(showCountdown).catch(() => {}); }
}, { capture: true, passive: true });
let cardBuffer = '', lastKey = 0;
document.addEventListener('keydown', event => {
  if (state.modal) {
    if (event.key === 'Escape' && ['password-login', 'floor-map', 'ticket-scan'].includes(state.modal)) void action('close-modal');
    if (event.key === 'Tab') {
      if (!event.shiftKey && event.target.id === 'ticket-barcode' && event.target.value.trim()) {
        event.preventDefault();
        void completeTicketScan(event.target);
        return;
      }
      const focusable = [...$('#modal-root').querySelectorAll('button:not(:disabled), input:not(:disabled)')];
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    return;
  }
  if (!event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey && ['Enter', ' '].includes(event.key)) {
    const station = event.target.closest('.iso-station[data-action]');
    if (station) {
      event.preventDefault();
      const selector = '.iso-station[data-action="' + CSS.escape(station.dataset.action) + '"]';
      station.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      root.querySelector(selector)?.focus({ preventScroll: true });
      return;
    }
  }
  if (state.data || event.ctrlKey || event.altKey || event.metaKey) return;
  const now = performance.now();
  if (now - lastKey > 180) cardBuffer = '';
  lastKey = now;
  if (event.key === 'Enter') {
    const uid = cardBuffer;
    cardBuffer = '';
    if (uid.length >= 4) { event.preventDefault(); void scan(uid); }
  }
  else if (/^[a-zA-Z0-9_-]$/.test(event.key)) { event.preventDefault(); cardBuffer = (cardBuffer + event.key).slice(0,64); }
});
let confirmingEpoch;
let countdownRevision = 0;
function showCountdown({ remaining, revision }) {
  if (revision <= countdownRevision) return;
  countdownRevision = revision ?? countdownRevision;
  state.seconds = remaining;
  for (const id of ['seconds', 'idle-seconds']) {
    const element = $('#' + id);
    if (element) element.textContent = remaining;
  }
  if (!state.data || remaining > 15) return;
  if (state.modal !== 'idle') { state.modal = 'idle'; renderModal(); }
}
if (window.stech) {
  window.stech.on('locked', reset);
  window.stech.on('admin', () => {
    if (state.modal === 'password-login' && state.loading) return;
    state.modal = 'admin'; state.pin = ''; renderModal();
  });
  window.stech.on('countdown', countdown => { if (confirmingEpoch !== state.epoch) showCountdown(countdown); });
}
function clockTick() {
  state.clock = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
  document.querySelectorAll('.clock').forEach(el => { el.textContent = state.clock; });
}
clockTick(); setInterval(clockTick, 10000);
setInterval(() => { if (state.info?.mode === 'connected' && state.data && !state.processing) void refreshLiveAccount(); }, 5000);
setInterval(() => { if (state.info?.mode === 'demo' && state.data && state.page === 'home' && !state.processing && !state.modal) void refresh().catch(() => {}); }, 15000);
setInterval(refreshPcAvailability, 5000);
call('info').then(info => { state.info = info; render(); void refreshPcAvailability(); }).catch(error => { root.innerHTML = '<div class="boot-error"><h1>S TECH</h1><p>' + e(error.message) + '</p></div>'; });
// Native touch scrolling and mouse dragging share the same coupon strip.
let couponDrag;
document.addEventListener('pointerdown', event => {
  couponDrag = undefined;
  const strip = event.target.closest('.coupon-list, .home-campaign-track');
  if (strip?.matches('.home-campaign-track') && event.isPrimary) {
    campaignPointerId = event.pointerId;
    scheduleCampaignRotation();
  }
  if (!strip || strip.scrollWidth <= strip.clientWidth || event.pointerType !== 'mouse' || event.button !== 0) return;
  couponDrag = { strip, x: event.clientX, left: strip.scrollLeft, moved: false };
});
document.addEventListener('pointermove', event => {
  if (!couponDrag || event.buttons !== 1) return;
  const distance = event.clientX - couponDrag.x;
  if (Math.abs(distance) > 6) couponDrag.moved = true;
  if (!couponDrag.moved) return;
  couponDrag.strip.classList.add('is-dragging');
  couponDrag.strip.scrollLeft = couponDrag.left - distance;
  event.preventDefault();
});
document.addEventListener('click', event => {
  if (!couponDrag?.moved) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  couponDrag = undefined;
}, true);
function endCouponDrag() {
  couponDrag?.strip.classList.remove('is-dragging');
  if (couponDrag && !couponDrag.moved) couponDrag = undefined;
}
document.addEventListener('pointerup', endCouponDrag);
document.addEventListener('pointercancel', () => { endCouponDrag(); couponDrag = undefined; });
function resumeCampaignRotation(event) {
  if (event.pointerId !== campaignPointerId) return;
  campaignPointerId = undefined;
  scheduleCampaignRotation();
}
document.addEventListener('pointerup', resumeCampaignRotation);
document.addEventListener('pointercancel', resumeCampaignRotation);
document.addEventListener('visibilitychange', scheduleCampaignRotation);
window.addEventListener('blur', () => {
  campaignPointerId = undefined;
  scheduleCampaignRotation();
});

let computerData;
let computersError = '';
let loadingComputers = false;
let selectedComputer;
let computerZone;
let computerNotice = '';
let computerStart;
let startingComputer = false;
const computerProgressTitle = request => request.waking ? 'Bilgisayarınız açılıyor' : 'Üye oturumunuz başlatılıyor';
async function startSelectedComputer() {
  if (startingComputer || !state.data || (!selectedComputer && !computerStart)) return;
  const balance = state.data.wallet?.balance;
  if (!computerStart && !state.walletStale && Number.isSafeInteger(balance) && balance < 1000) {
    showInsufficientBalance();
    return;
  }
  const epoch = state.epoch;
  computerStart ??= { terminalId: selectedComputer.id, name: selectedComputer.name, operationId: crypto.randomUUID(), waking: selectedComputer.canWake };
  const request = computerStart;
  startingComputer = true;
  state.modal = 'computer-progress'; render(); renderModal();
  try {
    while (epoch === state.epoch && computerStart === request) {
      const result = await call('startComputer', { terminalId: request.terminalId, operationId: request.operationId });
      if (epoch !== state.epoch) return;
      if (!['waking', 'pending'].includes(result.status)) {
        if (result.status === 'insufficient_balance') showInsufficientBalance();
        else toast(result.message);
        computerStart = undefined; selectedComputer = undefined;
        computersError = result.status === 'started' ? '' : result.message;
        await refreshLiveAccount(); await loadComputers();
        return;
      }
      if (result.status === 'waking') request.waking = true;
      else if (result.message) request.waking = false;
      request.accepted ||= result.status === 'waking' || Boolean(result.message);
      if (state.modal === 'computer-progress') {
        $('#computer-progress-title').textContent = computerProgressTitle(request);
        $('[data-action="computer-finish"]').disabled = !request.accepted;
      }
      render();
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  } catch (error) {
    if (epoch === state.epoch && computerStart === request) {
      computerStart = undefined; selectedComputer = undefined;
      computersError = error.message;
    }
  } finally {
    if (epoch === state.epoch) {
      startingComputer = false;
      if (state.modal === 'computer-progress') { state.modal = null; renderModal(); }
      render();
    }
  }
}
async function loadComputers() {
  if (loadingComputers || !state.data) return;
  const epoch = state.epoch;
  loadingComputers = true;
  try {
    const result = await call('computers');
    if (epoch !== state.epoch) return;
    computerData = result;
    computersError = '';
    if (selectedComputer && !computerStart) {
      const current = result.computers.find(pc => pc.id === selectedComputer.id);
        if (current?.available && (current.canStart ?? current.virtual) && result.startSupported) selectedComputer = current;
        else { computerNotice = `${selectedComputer.name} artık oturum açmaya uygun değil. Başka bir bilgisayar seç.`; selectedComputer = undefined; }
    }
  } catch (error) { if (epoch === state.epoch) computersError = error.message; }
  finally { loadingComputers = false; if (epoch === state.epoch && state.page === 'computers') render(); }
}
function computerStatusText(pc) { return pc.status === 'reserved' ? 'Oturum hazırlanıyor' : pc.canWake ? 'Kapalı, açılabilir' : pc.available ? 'Boş' : pc.status === 'occupied' ? 'Dolu' : 'Kullanıma hazır değil'; }
function computerStatusClass(pc) { return pc.available ? 'pc-free' : ['occupied', 'reserved'].includes(pc.status) ? 'pc-busy' : 'pc-off'; }
const zoneNames = { beginner: 'Beginner', player: 'Player', gamer: 'Gamer', master: 'Master 1', master2: 'Master 2' };
const computerPageAd = {
  title: 'Yeni nesil oyun deneyimi',
  subtitle: 'S TECH E-SPOR’da',
  image: 'assets/computers-banner.png',
};
function computerAdCarousel() {
  const knk = `<div class="zone-banner zone-banner-knk"><span>Powered by</span><img src="assets/knk-studios.png" alt="KNK Studios"></div>`;
  const stech = `<div class="zone-banner zone-banner-stech"><img src="${e(computerPageAd.image)}" alt="">
    <div class="zone-ad-copy"><strong>${e(computerPageAd.title)}</strong><span>${e(computerPageAd.subtitle)}</span></div></div>`;
  // The matching KNK slides at both ends make the reset invisible.
  const elapsed = (performance.now() - (zoneAdStartedAt ?? performance.now())) % 4000;
  return `<section class="zone-ad" aria-label="Powered by KNK Studios · S TECH E-SPOR"><div class="zone-ad-track" aria-hidden="true" style="--banner-delay:${-elapsed}ms">${knk}${stech}${knk}</div></section>`;
}
function computerZonePicker(groups, alerts) {
  const cards = groups.map(({ zone, computers, total, available }) => {
    const occupied = computers.filter(pc => ['occupied', 'reserved'].includes(pc.status)).length;
    const occupiedPercent = total ? (occupied / total) * 100 : 0;
    const availablePercent = total ? (available / total) * 100 : 0;
    return `<button class="zone-choice" data-action="computer-zone:${zone.id}" ${!computerData || computerStart ? 'disabled' : ''}>
      <span class="zone-choice-icon">${icon('monitor')}</span>
      <span class="zone-choice-info">
        <strong class="zone-choice-name">${zoneNames[zone.id] || e(zone.name)}</strong>
        <span class="zone-choice-count">${computerData ? `<b>${available}/${total}</b> kullanılabilir` : 'Bilgisayar durumu alınıyor'}</span>
        <span class="zone-choice-meter" aria-hidden="true"><i class="zone-meter-free" style="width:${availablePercent}%"></i><i class="zone-meter-busy" style="width:${occupiedPercent}%"></i></span>
      </span>
      <span class="zone-choice-next" aria-hidden="true"></span>
    </button>`;
  }).join('');
  return `<section class="zone-picker" aria-labelledby="zone-picker-title">
    <div class="zone-picker-top">${button(icon('back') + ' Ana ekrana dön', 'go-home', 'zone-back')}</div>
    <div class="zone-picker-heading"><h1 id="zone-picker-title">Masanı seç</h1><p>Oyun alanını seç, deneyimine başla.</p></div>
    ${alerts}
    <div class="zone-choice-list">${cards}</div>
    ${computerAdCarousel()}
  </section>`;
}
function computersPage() {
  const groups = ComputerZones.summarize(computerData?.computers).filter(({ zone }) => zone.layout);
  const group = groups.find(g => g.zone.id === computerZone);
  const alerts = `${computersError ? `<div role="alert" class="notice">${e(computersError)}</div>` : ''}
    ${computerNotice ? `<div role="status" class="notice">${e(computerNotice)}</div>` : ''}
    ${computerStart ? `<div class="notice" role="status">${e(computerStart.waking ? 'Bilgisayarınız açılıyor. PanCafe bağlantısı bekleniyor…' : 'PanCafe’de oturumunuz başlatılıyor…')}</div>` : ''}
    ${!computerData && !computersError ? '<p role="status">Bilgisayarlar alınıyor…</p>' : ''}
    ${computerData && !computerData.startSupported ? '<div class="notice">Bu şubede kiosktan oturum açma etkin değil. Şube yetkilisine başvur.</div>' : ''}`;
  if (!group) return computerZonePicker(groups, alerts);
  const canPick = Boolean(computerData.startSupported) && !computerStart;
  const pick = selectedComputer && group.computers.some(pc => pc.id === selectedComputer.id) ? selectedComputer : undefined;
  const chip = pc => `<button class="pc-chip ${computerStatusClass(pc)} ${pick?.id === pc.id ? 'pc-picked' : ''}" ${pc.available && !computerStart ? `data-action="computer-select:${e(pc.id)}"` : 'disabled'} aria-pressed="${pick?.id === pc.id}" aria-label="${e(pc.name)}, ${computerStatusText(pc)}">${group.zone.layout && pc.number !== undefined ? pc.number : e(pc.name)}</button>`;
  return `<div class="page-heading"><div><span class="eyebrow">OYUN ALANIN</span><h1>${e(group.zone.name)}</h1><p><strong class="positive">${group.available}</strong> / ${group.total} bilgisayar boş. Durumlar otomatik güncellenir.</p></div>${button(`${icon('back')}Tür seçimine dön`, 'computer-zones', 'secondary', Boolean(computerStart))}</div>
    ${alerts}
    <section class="panel map-panel">
      <div class="map-legend"><span><i class="pc-free"></i>Boş</span><span><i class="pc-busy"></i>Dolu</span><span><i class="pc-picked"></i>Seçimin</span><span><i class="pc-off"></i>Kapalı</span></div>
      ${group.zone.layout ? `<div class="map-stage">${ComputerZones.isoMap(group.zone, group.computers, pick?.id, canPick)}${group.zone.layout.hint ? `<span class="map-hint map-hint-entry">${e(group.zone.layout.hint)}</span>` : ''}</div>` : ''}
      <div class="pc-chips ${group.zone.layout ? '' : 'pc-chips-large'}">${group.computers.map(chip).join('')}</div>
      ${group.total ? '' : '<p class="muted">Bu türde PanCafe’de tanımlı bilgisayar bulunamadı.</p>'}
    </section>
    <section class="panel pick-bar ${pick ? 'pick-ready' : ''}" aria-live="polite">${pick
      ? `<div><span class="eyebrow">SEÇİMİN</span><h2>${e(pick.name)}</h2><p>${pick.canWake ? 'Bilgisayar açıldığında üye oturumun başlar. ' : ''}Oturum ${e(state.data.member.username)} üyeliğinle başlar. PanCafe’deki üye tarifesi ve varsa açılış ücreti uygulanır.</p></div><div class="pick-actions">${button('Onayla ve oturumu başlat', 'computer-confirm', 'primary', !canPick)}${button('Seçimi kaldır', 'computer-clear', 'secondary', Boolean(computerStart))}</div>`
      : `<p>${canPick ? 'Yeşil bir bilgisayara dokunarak seçimini yap.' : 'Şu anda seçim yapılamıyor.'}</p>`}</section>`;
}
setInterval(() => { if (state.data && state.page === 'computers') void loadComputers(); }, 5000);
