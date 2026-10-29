'use strict';
const $ = selector => document.querySelector(selector);
const root = $('#app');
const state = { info: null, data: null, page: 'home', epoch: 0, loading: false, filter: 'all', history: [], sessions: [], cursor: undefined, sessionCursor: undefined, historyLoading: false, amount: '200', quote: null, payment: null, processing: false, quoteVersion: 0, modal: null, pin: '', seconds: 90, clock: '' };
const e = text => String(text ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const cash = amount => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(amount / 100);
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
 info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>'
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.info}</svg>`;
const button = (text, action, cls = '', disabled = false) => `<button class="button ${cls}" data-action="${action}" ${disabled ? 'disabled' : ''}>${text}</button>`;
const logo = '<div class="brand"><img src="assets/brand-logo.png" alt="S TECH"><span>S TECH<small>GAMING EXPERIENCE</small></span></div>';
const badge = () => `<span class="status ${state.info?.mode === 'demo' ? 'demo' : ''}"><i></i>${state.info?.mode === 'demo' ? 'DENEME MODU' : 'ÜYE NOKTASI'}</span>`;
function toast(message) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { $('#toast').hidden = true; }, 6000);
}
async function call(action, payload) {
  if (!window.stech) throw new Error('Bu ekranı kiosk uygulamasından açın.');
  const result = await window.stech.call(action, payload);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
function reset() {
  state.epoch++; state.quoteVersion++; state.data = null; state.loading = false; state.historyLoading = false; state.page = 'home'; state.history = []; state.sessions = []; state.cursor = undefined; state.sessionCursor = undefined; state.payment = null; state.processing = false; state.modal = null; state.pin = ''; state.quote = null; state.amount = '200'; state.filter = 'all'; cardBuffer = '';
  $('#toast').hidden = true; render(); renderModal();
}
function welcome() {
  return `<div class="welcome"><header>${logo}<div class="header-right">${badge()}<span class="clock">${e(state.clock)}</span></div></header>
    <main class="welcome-main"><div class="welcome-copy"><span class="eyebrow"><span class="tiny-line"></span> OYUN BURADA BAŞLAR</span><h1>Hazırsan,<br><span>oyuna devam.</span></h1><p>Bakiyen, avantajların ve hesabın.<br>Hepsi tek dokunuş uzağında.</p><div class="welcome-benefits"><span>${icon('topup')}Hızlı yükleme</span><span>${icon('campaigns')}Sana özel fırsatlar</span></div></div>
    <section class="tap-panel"><div class="panel-top"><span>01 / KARTINLA GİRİŞ YAP</span>${icon('shield')}</div><div class="tap-orbit"><div class="tap-ring"></div><div class="tap-ring second"></div><div class="member-card"><div class="member-card-head">S TECH ${icon('nfc')}</div><div class="card-chip"></div><div class="member-card-bottom">PLAYER CARD<span>•••• •••• ••••</span></div></div><span class="tap-symbol">${icon('nfc')}</span></div><h2>${state.loading ? 'Hesabın açılıyor…' : 'Üye kartını okut'}</h2><p>Kartını bilgisayarın yanındaki<br>NFC okuyucuya yaklaştır.</p><div class="reader-status"><i class="${state.loading ? 'pulse' : ''}"></i>${state.loading ? 'Bilgilerin kontrol ediliyor' : 'Kart okutmanı bekliyoruz'}</div>
    ${state.info?.mode === 'demo' ? `<div class="demo-entry"><span>Keşfetmek için bir deneme hesabı seç</span>${button('Kaan olarak dene ' + icon('arrow'), 'demo1', 'primary', state.loading)}${button('Deniz olarak dene', 'demo2', 'quiet', state.loading)}</div>` : '<div class="secure-note">' + icon('shield') + ' Oturumun işlem sonunda güvenle kapanır.</div>'}</section></main>
    <footer><span>${e(state.info?.station || 'S TECH')} <span class="footer-separator">/</span> MÜŞTERİ NOKTASI</span><span>İyi oyunlar. <span class="orange">İyi ki buradasın.</span></span></footer></div>`;
}
const nav = [{ id: 'home', label: 'Ana ekran', icon: 'home' }, { id: 'topup', label: 'Bakiye yükle', icon: 'topup' }, { id: 'campaigns', label: 'Kampanyalar', icon: 'campaigns' }, { id: 'history', label: 'İşlem geçmişi', icon: 'history' }, { id: 'profile', label: 'Profilim', icon: 'profile' }];
function render() {
  if (!state.data) { root.innerHTML = welcome(); return; }
  const member = state.data.member;
  const title = { home: 'Ana ekran', topup: 'Bakiye yükle', campaigns: 'Kampanyalar', history: 'İşlem geçmişi', profile: 'Profilim' }[state.page];
  root.innerHTML = `<div class="shell"><aside>${logo}<div class="station-label">MÜŞTERİ NOKTASI</div><nav aria-label="Ana menü">${nav.map(n => `<button data-page="${n.id}" class="nav-item ${state.page === n.id ? 'active' : ''}" ${state.page === n.id ? 'aria-current="page"' : ''}>${icon(n.icon)}${n.label}${state.page === n.id ? '<span class="nav-dot"></span>' : ''}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="member-mini"><div class="avatar">${e(member.name.charAt(0))}</div><div><strong>${e(member.name)}</strong><span>${e(member.username)}</span></div></div>${button(icon('logout') + ' Oturumu bitir', 'logout', 'logout-button')}<span class="sidebar-foot">${icon('shield')} Bu bilgisayar ortak kullanımdadır.</span></div></aside><div class="workspace"><header><span class="breadcrumb">S TECH <span>/</span> ${title}</span><div class="header-right">${badge()}<span class="clock">${e(state.clock)}</span></div></header><main class="content">${state.page === 'home' ? home() : state.page === 'topup' ? topup() : state.page === 'campaigns' ? campaigns() : state.page === 'history' ? history() : profile()}</main><footer><span>${icon('shield')} İşlemin bittiğinde oturumunu kapatmayı unutma.</span><button class="session-time" data-action="continue">Oturum <b id="seconds">${Math.ceil(state.seconds)}</b> sn ${icon('history')}</button></footer></div></div>`;
}
function rows(items) {
  if (!items.length) return '<div class="empty">' + icon('history') + '<h3>Henüz işlem yok</h3><p>Hesap hareketlerin burada görünecek.</p></div>';
  return items.map(t => `<div class="transaction"><div class="transaction-icon ${e(t.kind)}">${icon(t.kind === 'usage' ? 'monitor' : t.kind === 'bonus' ? 'bolt' : 'topup')}</div><div class="transaction-description"><strong>${e(t.title)}</strong><span>${date(t.createdAt)}</span></div><div class="transaction-amount ${t.amount > 0 ? 'positive' : ''}"><strong>${t.amount > 0 ? '+' : ''}${cash(t.amount)}</strong><span>Bakiye ${cash(t.balanceAfter)}</span></div></div>`).join('');
}
function campaignCard(p) {
  return `<article class="campaign-card"><span class="eyebrow">YÜKLEDİKÇE KAZAN</span><div class="campaign-big">%${e(p.bonusPercent)}<span>BONUS</span></div><h3>${e(p.title)}</h3><p>${e(p.description)}</p>${button('Kampanyayı incele ' + icon('arrow'), 'campaign:' + e(p.id), 'light-button')}<div class="campaign-watermark">+</div></article>`;
}
function home() {
  const d = state.data;
  return `<div class="page-heading"><div><span class="eyebrow">TEKRAR HOŞ GELDİN</span><h1>Merhaba, ${e(d.member.name.split(' ')[0])}<span class="orange">.</span></h1><p>Yeni bir oyun, yeni bir heyecan. Hesabın hazır.</p></div><span class="member-badge">${icon('nfc')} S TECH ÜYESİ</span></div>
  <div class="home-grid"><section class="balance-card"><div class="balance-top"><span>${icon('topup')} KULLANILABİLİR BAKİYEN</span><span class="balance-mark">S /</span></div><div class="balance-value">${cash(d.wallet.balance)}</div><div class="balance-caption">${state.info.mode === 'demo' ? 'Deneme bakiyesi · Gerçek para değildir' : 'PanCafe hesabındaki güncel bakiye'}</div><div class="balance-bottom">${button('Bakiye yükle ' + icon('plus'), 'go-topup', 'primary')}<span>${icon('shield')} ${state.info.mode === 'demo' ? 'Deneme ortamı' : 'PanCafe bağlantısı'}</span></div><div class="balance-decoration"></div></section>
  ${d.promotions[0] ? campaignCard(d.promotions[0]) : '<section class="panel no-campaign">' + icon('campaigns') + '<h2>Yeni fırsatlara yer aç.</h2><p>Aktif kampanyalar burada görünecek.</p></section>'}</div>
  <div class="quick-strip"><div>${icon('nfc')}<span>Kartın yanında,<strong>hesabın elinin altında.</strong></span></div><p>Yükle, avantajları keşfet, oyuna devam et.</p>${button('Hesabımı görüntüle ' + icon('arrow'), 'go-profile', 'quiet')}</div>
  ${(d.pendingPayments || []).length ? `<section class="pending-banner">${icon('history')}<div><strong>Tamamlanmamış işlemin var</strong><span>Kaldığın yerden devam edebilirsin.</span></div>${button('İşlemi aç', 'resume:' + d.pendingPayments[0].id, 'secondary')}</section>` : ''}
  <section class="panel recent"><div class="section-heading"><h2>Son işlemler</h2>${button('Tümünü gör ' + icon('arrow'), 'go-history', 'quiet')}</div>${rows(d.transactions)}</section>`;
}
function topup() {
  if (state.payment) return paymentView();
  const amount = Number(state.amount || 0) * 100;
  const q = state.quote;
  return `<div class="page-heading"><div><span class="eyebrow">OYUNA ARA VERME</span><h1>Bir sonraki oyuna hazır ol.</h1><p>Yüklemek istediğin tutarı seç, kartınla öde, devam et.</p></div></div>
  ${state.info.mode === 'demo' ? '<div class="notice">' + icon('info') + ' Deneme ortamındasın. POS ve bakiye işlemleri temsili olarak çalışır.</div>' : '<div class="notice">' + icon('info') + ' POS cihazı henüz eşleştirilmedi. Gerçek yükleme için şube yetkilisine başvur.</div>'}
  <div class="topup-grid"><section class="panel amount-panel"><div class="section-heading"><h2>Yükleme tutarı</h2><span>01 / 02</span></div><div class="amount-display"><span>₺</span><strong>${e(state.amount || '0')}</strong><span>TL</span></div><div class="amount-presets">${[100, 200, 500, 1000].map(n => button(`${n} TL`, `amount:${n}`, Number(state.amount) === n ? 'preset selected' : 'preset')).join('')}</div><div class="keypad">${['1','2','3','4','5','6','7','8','9','clear','0','back'].map(k => button(k === 'clear' ? 'Temizle' : k === 'back' ? '⌫' : k, `key:${k}`, k === 'clear' ? 'key key-small' : 'key')).join('')}</div><p class="muted minimum">En az 50 TL · En fazla 10.000 TL</p></section>
  <section class="summary-column"><div class="panel summary"><span class="eyebrow">İŞLEM ÖZETİ</span><h2>Oyunun kesilmesin.</h2><div class="summary-row"><span>Yüklenecek tutar</span><strong>${cash(amount)}</strong></div><div class="summary-row"><span>Kampanya bonusu</span><strong class="positive">+${cash(q?.bonus || 0)}</strong></div><div class="summary-total"><span>Hesabına eklenecek</span><strong>${q ? cash(q.total) : '—'}</strong></div>${q?.bonus ? '<div class="bonus-note">' + icon('bolt') + ' Bu yüklemeyle bonus kazanıyorsun.</div>' : '<p class="muted">Geçerli kampanyalar otomatik uygulanır.</p>'}${button('POS ile ödemeye geç ' + icon('arrow'), 'pay', 'primary wide', !q || !state.data.features.topup || state.processing)}<div class="secure-note">${icon('shield')} Kart bilgilerin bu bilgisayarda tutulmaz.</div></div><div class="payment-how"><span>NASIL ÇALIŞIR?</span><p><b>1</b> Yükleme tutarını seç.</p><p><b>2</b> POS cihazındaki adımları izle.</p><p><b>3</b> Bakiye onayını ekranda gör.</p></div></section></div>`;
}
function paymentView() {
  const p = state.payment, done = p.status === 'completed', failed = p.status === 'failed';
  return `<div class="payment-page">${!state.processing && !done ? button(icon('back') + ' Tutara geri dön', 'payment-back', 'quiet') : ''}<div class="payment-steps"><span class="finished">1 <b>Tutar seçimi</b></span><i></i><span class="${done ? 'finished' : 'current'}">2 <b>POS ile ödeme</b></span><i></i><span class="${done ? 'finished' : ''}">3 <b>Bakiye onayı</b></span></div><section class="panel payment-panel"><div class="payment-illustration ${done ? 'success' : failed ? 'failure' : ''}">${icon(done ? 'check' : failed ? 'close' : 'topup')}</div><span class="eyebrow">${done ? 'İŞLEM TAMAMLANDI' : failed ? 'ÖDEME ONAYLANMADI' : 'POS İLE ÖDEME'}</span><h1>${done ? 'Hazırsın. İyi oyunlar!' : failed ? 'Tekrar deneyebilirsin.' : state.processing ? 'İşlemin kontrol ediliyor…' : 'Kartını POS cihazına okut.'}</h1><p>${done ? 'Yüklemen ve bonusun deneme hesabına eklendi.' : failed ? 'Hesabından tahsilat yapılmadı ve bakiye eklenmedi.' : 'POS cihazındaki yönlendirmeleri takip et.<br>Ödeme sonucu burada görünecek.'}</p><div class="payment-value">${cash(p.amount)}</div><div class="payment-receipt"><span>Yükleme <b>${cash(p.amount)}</b></span><span>Bonus <b class="positive">+${cash(p.bonus)}</b></span>${done ? '<span>Yeni bakiye <b>' + cash(p.balanceAfter) + '</b></span>' : ''}</div>
  ${done ? '<div class="completion-choice"><h2>Başka bir işlem yapmak ister misin?</h2><div class="completion-actions">' + button('Başka bir işlem yap ' + icon('arrow'), 'another-transaction', 'secondary', state.processing) + button('İşlemleri bitir ' + icon('check'), 'finish-session', 'primary') + '</div><p class="completion-countdown">Seçim yapmazsan <b id="completion-seconds">' + Math.ceil(state.seconds) + '</b> saniye sonra oturumun kapanacak.</p></div>' : failed ? button('Yeni işlem başlat', 'payment-back', 'primary') : `<div class="pos-demo"><span>DENEME POS KONTROLLERİ · GERÇEK TAHSİLAT YOK</span><div>${button(icon('check') + ' Ödemeyi onayla', 'approve', 'primary', state.processing)}${button('Ödemeyi reddet', 'decline', 'secondary', state.processing)}</div></div>`}
  <div class="receipt-id">İşlem no: ${e(p.id)}</div></section></div>`;
}
function campaigns() {
  return `<div class="page-heading"><div><span class="eyebrow">DAHA FAZLA OYUN, DAHA FAZLA AVANTAJ</span><h1>Oyunun avantajlı hali.</h1><p>Geçerli fırsatları keşfet. Yüklemenden daha fazlasını al.</p></div></div><div class="campaign-grid">${state.data.promotions.length ? state.data.promotions.map(campaignCard).join('') : '<div class="panel empty">' + icon('campaigns') + '<h2>Şu an aktif kampanya yok.</h2><p>Yeni fırsatlar bu alanda görünecek.</p></div>'}</div><div class="notice neutral">${icon('info')} Bonuslar yükleme sırasında otomatik hesaplanır. Kampanya koşullarını inceleyebilirsin.</div>`;
}
function history() {
  const filtered = state.history.filter(t => state.filter === 'all' || state.filter === t.kind);
  return `<div class="page-heading"><div><span class="eyebrow">HESABININ KONTROLÜ SENDE</span><h1>Her hareket, tek yerde.</h1><p>Yüklemelerini, bonuslarını ve harcamalarını incele.</p></div>${button('Yenile', 'history-refresh', 'secondary', state.historyLoading)}</div><div class="filter-bar">${[['all','Tüm işlemler'],['topup','Yüklemeler'],['bonus','Bonuslar'],['usage','Harcamalar'],['adjustment','Diğer']].map(([id,label]) => button(label, 'filter:' + id, 'filter ' + (state.filter === id ? 'selected' : ''))).join('')}</div><section class="panel history-panel">${rows(filtered)}${state.historyLoading ? '<p class="loading-line">İşlemler yükleniyor…</p>' : ''}${state.cursor ? button('Daha eski işlemleri yükle', 'history-more', 'secondary wide', state.historyLoading) : ''}</section>
  ${state.info.mode === 'connected' ? `<section class="panel session-panel"><h2>PC oturum ayrıntıları</h2>${state.sessions.length ? state.sessions.map(s => `<div class="transaction">${icon('monitor')}<div class="transaction-description"><strong>${e(s.terminal)} · ${e(s.durationMinutes)} dakika</strong><span>${date(s.startedAt)} – ${date(s.endedAt)}</span></div><strong>${cash(s.usageAmount)}</strong></div>`).join('') : '<p class="muted">Tamamlanmış PC oturumu bulunmuyor.</p>'}${state.sessionCursor ? button('Daha eski oturumlar', 'sessions-more', 'secondary wide', state.historyLoading) : ''}</section>` : ''}`;
}
function profile() {
  const m = state.data.member;
  return `<div class="page-heading"><div><span class="eyebrow">S TECH HESABIN</span><h1>Seni tanımak güzel.</h1><p>Üyelik bilgilerin ve hesabınla ilgili her şey.</p></div></div><div class="profile-grid"><section class="panel profile-card"><div class="avatar large">${e(m.name.charAt(0))}</div><h2>${e(m.name)}</h2><span class="muted">@${e(m.username)}</span><span class="member-badge">${icon('nfc')} S TECH ÜYESİ</span><div class="profile-balance"><span>Kullanılabilir bakiye</span><strong>${cash(state.data.wallet.balance)}</strong></div></section><section class="panel profile-details"><h2>Hesap bilgilerim</h2>${[['Ad soyad',m.name],['Kullanıcı adı',m.username],['Telefon',m.phone || 'Belirtilmemiş'],['E-posta',m.email || 'Belirtilmemiş'],['Üyelik tarihi',new Date(m.joinedAt).toLocaleDateString('tr-TR')]].map(([label,value]) => `<div class="summary-row"><span>${label}</span><strong>${e(value)}</strong></div>`).join('')}<div class="notice neutral">${icon('info')} Bilgilerini güncellemek veya kartınla ilgili destek almak için S TECH yetkilisine başvurabilirsin.</div></section></div><section class="privacy-strip">${icon('shield')}<div><strong>Hesabın sana özel.</strong><p>İşin bittiğinde oturumunu kapat. Bir sonraki müşteri bilgilerini göremez.</p></div>${button('Oturumu bitir ' + icon('logout'), 'logout', 'secondary')}</section>`;
}
function renderModal() {
  const host = $('#modal-root');
  if (!state.modal) { host.innerHTML = ''; return; }
  let content;
  if (state.modal === 'idle') content = `<div class="modal-symbol">${icon('history')}</div><h2>Hâlâ burada mısın?</h2><p>Gizliliğin için oturumun <b id="idle-seconds">${Math.ceil(state.seconds)}</b> saniye sonra kapanacak.</p>${button('Buradayım, devam et', 'continue', 'primary wide')}${button('Oturumu bitir', 'logout', 'quiet wide')}`;
  else if (state.modal === 'logout') content = `<div class="modal-symbol">${icon('logout')}</div><h2>İşlemlerin tamam mı?</h2><p>Oturumun kapanacak ve ekran yeni müşteri için hazırlanacak.</p>${button('Evet, oturumu bitir', 'confirm-logout', 'primary wide')}${button('Hesabıma dön', 'close-modal', 'secondary wide')}`;
  else if (state.modal === 'admin') content = `<span class="eyebrow">YETKİLİ ERİŞİMİ</span><h2>Kiosku kapat</h2><p>Yetkili PIN kodunu gir.${state.info?.mode === 'demo' ? ' Deneme PIN: 2026.' : ''}</p><input class="pin-input" type="password" value="${e(state.pin)}" maxlength="16" inputmode="numeric" autocomplete="off" aria-label="Yetkili PIN kodu"><div class="keypad admin-keypad">${['1','2','3','4','5','6','7','8','9','clear','0','back'].map(k => button(k === 'clear' ? 'Sil' : k === 'back' ? '⌫' : k, 'pin:' + k, 'key')).join('')}</div>${button('Uygulamayı kapat', 'admin-exit', 'primary wide')}${button('Geri dön', 'close-modal', 'quiet wide')}`;
  else {
    const p = state.data?.promotions.find(p => p.id === state.modal);
    if (!p) { state.modal = null; host.innerHTML = ''; return; }
    content = `<span class="eyebrow">KAMPANYA DETAYI</span><h2>${e(p.title)}</h2><p>${e(p.description)}</p><div class="campaign-terms"><strong>Kampanya koşulları</strong><p>${e(p.terms)}</p><span>Son gün: ${new Date(p.endsAt).toLocaleDateString('tr-TR')}</span></div>${button('Bakiye yükle ' + icon('arrow'), 'modal-topup', 'primary wide')}${button('Geri dön', 'close-modal', 'quiet wide')}`;
  }
  host.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="${state.modal === 'admin' ? 'Yetkili erişimi' : 'Bilgilendirme'}">${content}</section></div>`;
  host.querySelector('input, button')?.focus();
}
async function scan(uid) {
  if (state.data || state.loading || state.modal) return;
  const epoch = state.epoch; state.loading = true; render();
  try { const data = await call('scan', { uid }); if (epoch !== state.epoch) return; state.data = data; state.seconds = 90; state.page = 'home'; render(); }
  catch (error) { if (epoch === state.epoch) toast(error.message); }
  finally { if (epoch === state.epoch) { state.loading = false; render(); } }
}
async function refresh() {
  const epoch = state.epoch;
  const data = await call('dashboard');
  if (epoch === state.epoch && state.data) { state.data = data; render(); }
}
async function loadHistory(more = false, sessionsOnly = false) {
  if (state.historyLoading) return;
  const epoch = state.epoch; state.historyLoading = true; render();
  try {
    if (!sessionsOnly) {
      const data = await call('transactions', { cursor: more ? state.cursor : undefined });
      if (epoch !== state.epoch) return;
      state.history = more ? [...state.history, ...data.items] : data.items; state.cursor = data.nextCursor;
    }
    if (state.info.mode === 'connected' && (!more || sessionsOnly)) {
      const data = await call('sessions', { cursor: sessionsOnly ? state.sessionCursor : undefined });
      if (epoch !== state.epoch) return;
      state.sessions = sessionsOnly ? [...state.sessions, ...data.items] : data.items; state.sessionCursor = data.nextCursor;
    }
  } finally { if (epoch === state.epoch) { state.historyLoading = false; render(); } }
}
async function updateQuote() {
  const version = ++state.quoteVersion, epoch = state.epoch;
  state.quote = null; render();
  const amount = Number(state.amount || 0) * 100;
  if (amount < 5000 || amount > 1000000 || !state.data.features.topup) return;
  const q = await call('quote', { amount });
  if (version === state.quoteVersion && epoch === state.epoch) { state.quote = q; render(); }
}
async function go(page) {
  if (state.processing) return;
  if (state.payment?.status === 'completed') { toast('Devam etmek için “Başka bir işlem yap” seçeneğine dokun.'); return; }
  if (state.payment?.status === 'pending') { toast('Önce ödeme ekranındaki işlemi tamamla veya tutara geri dön.'); return; }
  state.page = page; state.payment = null; state.modal = null; renderModal(); render();
  if (page === 'history') await loadHistory();
  if (page === 'topup') await updateQuote();
}
async function action(value) {
  const [name, arg] = value.split(':');
  if (name === 'demo1' || name === 'demo2') return scan(name === 'demo1' ? 'DEMO0001' : 'DEMO0002');
  if (name === 'finish-session' || (name === 'logout' && state.payment?.status === 'completed')) { reset(); await call('logout'); return; }
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
  if (name === 'confirm-logout') { reset(); await call('logout'); return; }
  if (name === 'continue' && state.payment?.status === 'completed') return;
  if (name === 'continue') { await call('activity'); state.modal = null; renderModal(); return; }
  if (name === 'close-modal') { state.modal = null; state.pin = ''; renderModal(); return; }
  if (name === 'campaign') { state.modal = arg; renderModal(); return; }
  if (name === 'modal-topup') return go('topup');
  if (name.startsWith('go-')) return go(name.slice(3));
  if (name === 'filter') { state.filter = arg; render(); return; }
  if (name === 'history-refresh') return loadHistory();
  if (name === 'history-more') return loadHistory(true);
  if (name === 'sessions-more') return loadHistory(true, true);
  if (name === 'amount') { state.amount = arg; return updateQuote(); }
  if (name === 'key') {
    state.amount = arg === 'clear' ? '' : arg === 'back' ? state.amount.slice(0,-1) : (state.amount === '0' ? arg : (state.amount + arg).slice(0,5));
    return updateQuote();
  }
  if (name === 'pay') {
    if (state.processing || !state.quote) return;
    const epoch = state.epoch; state.processing = true; render();
    try { const payment = await call('create', { amount: Number(state.amount) * 100, key: crypto.randomUUID() }); if (epoch !== state.epoch) return; state.payment = payment; }
    finally { if (epoch === state.epoch) { state.processing = false; render(); } }
    return;
  }
  if (name === 'resume') { const epoch = state.epoch; const payment = await call('payment', { id: arg }); if (epoch !== state.epoch) return; state.payment = payment; if (payment.completionSeconds !== undefined) state.seconds = payment.completionSeconds; state.page = 'topup'; render(); return; }
  if (name === 'approve' || name === 'decline') {
    if (state.processing || !state.payment || state.payment.status !== 'pending') return;
    const epoch = state.epoch; state.processing = true; render();
    try { const payment = await call('settle', { id: state.payment.id, outcome: name === 'approve' ? 'approved' : 'declined' }); if (epoch !== state.epoch) return; state.payment = payment; if (payment.completionSeconds !== undefined) { state.seconds = payment.completionSeconds; state.modal = null; renderModal(); } await refresh(); }
    finally { if (epoch === state.epoch) { state.processing = false; render(); } }
    return;
  }
  if (name === 'payment-back' && state.payment?.status !== 'completed') { state.payment = null; return updateQuote(); }
  if (name === 'pin') { state.pin = arg === 'clear' ? '' : arg === 'back' ? state.pin.slice(0,-1) : (state.pin + arg).slice(0,16); renderModal(); return; }
  if (name === 'admin-exit') { await call('adminExit', { pin: state.pin }); return; }
}
document.addEventListener('click', event => {
  const target = event.target.closest('button'); if (!target || target.disabled) return;
  const epoch = state.epoch;
  const task = target.dataset.page ? go(target.dataset.page) : target.dataset.action ? action(target.dataset.action) : null;
  Promise.resolve(task).catch(error => { if (epoch === state.epoch) toast(error.message); });
});
document.addEventListener('input', event => { if (event.target.matches('.pin-input')) state.pin = event.target.value; });
let lastActivity = 0;
for (const event of ['pointerdown','keydown']) document.addEventListener(event, () => {
  if (state.data && Date.now() - lastActivity > 1000) { lastActivity = Date.now(); void call('activity').catch(() => {}); }
});
let cardBuffer = '', lastKey = 0;
document.addEventListener('keydown', event => {
  if (state.modal) {
    if (event.key === 'Tab') {
      const focusable = [...$('#modal-root').querySelectorAll('button, input')].filter(el => !el.disabled);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    return;
  }
  if (state.data || event.ctrlKey || event.altKey || event.metaKey) return;
  const now = performance.now();
  if (now - lastKey > 180) cardBuffer = '';
  lastKey = now;
  if (event.key === 'Enter') { event.preventDefault(); const uid = cardBuffer; cardBuffer = ''; if (uid.length >= 4) void scan(uid); }
  else if (/^[a-zA-Z0-9_-]$/.test(event.key)) { event.preventDefault(); cardBuffer = (cardBuffer + event.key).slice(0,64); }
});
if (window.stech) {
  window.stech.on('locked', reset);
  window.stech.on('admin', () => { state.modal = 'admin'; state.pin = ''; renderModal(); });
  window.stech.on('countdown', seconds => {
    state.seconds = seconds;
    if ($('#seconds')) $('#seconds').textContent = Math.ceil(seconds);
    if ($('#completion-seconds')) $('#completion-seconds').textContent = Math.ceil(seconds);
    if (state.payment?.status === 'completed') return;
    if ($('#idle-seconds')) $('#idle-seconds').textContent = Math.ceil(seconds);
    if (seconds <= 15 && state.data && state.modal !== 'idle') { state.modal = 'idle'; renderModal(); }
  });
}
function clockTick() {
  state.clock = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
  document.querySelectorAll('.clock').forEach(el => { el.textContent = state.clock; });
}
clockTick(); setInterval(clockTick, 10000);
setInterval(() => { if (state.data && state.page === 'home' && !state.processing && !state.modal) void refresh().catch(() => {}); }, 15000);
call('info').then(info => { state.info = info; render(); }).catch(error => { root.innerHTML = '<div class="boot-error"><h1>S TECH</h1><p>' + e(error.message) + '</p></div>'; });
