/* Uses the existing admin session and server-side authorization. No raw JSON editor. */
const kioskEditor = { draft: null, dirty: false, tab: 'brand', screen: 'home', selected: null,
    async open(host) { this.host = host; if (!this.draft || this.actor !== admin.username) {
        this.draft = await api('kiosk-design');
        this.dirty = false;
        this.actor = admin.username;
    } this.draw(); },
    mark() { this.dirty = true; const status = document.querySelector('#design-status'); if (status)
        status.textContent = 'Kaydedilmemiş değişiklikler'; this.preview(); },
    preview() { const frame = document.querySelector('#design-preview'); frame?.contentWindow?.postMessage({ type: 'stech-preview', document: this.draft.document, page: this.screen, blockId: this.selected }, location.origin); },
    field(label, path, type = 'text', options) { const value = path.split('.').reduce((a, k) => a?.[k], this.draft.document); return `<label class="design-field">${esc(label)}${options ? `<select data-design-path="${path}">${options.map(([v, t]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>` : `<input data-design-path="${path}" type="${type}" ${type === 'checkbox' ? (value ? 'checked' : '') : `value="${esc(value)}"`} ${type === 'number' ? 'step="1"' : ''}>`}</label>`; },
    draw() {
        const d = this.draft.document;
        const tabs = { brand: 'Marka', pages: 'Ekranlar ve bölümler', navigation: 'Menü ve butonlar', theme: 'Tema', media: 'Medya kütüphanesi', behavior: 'Kiosk davranışları', texts: 'Metinler ve diller', history: 'Yayın geçmişi' };
        this.host.innerHTML = `<section class="design-toolbar"><div><strong>Kiosk tasarım merkezi</strong><p id="design-status">${this.dirty ? 'Kaydedilmemiş değişiklikler' : 'Taslak kaydedildi'} · revizyon ${this.draft.revision}</p></div><button data-design="reload">Taslağı yeniden yükle</button><button data-design="save" ${!canWrite() ? 'disabled' : ''}>Taslağı kaydet</button><button data-design="publish" ${admin.role !== 'owner' ? 'disabled' : ''}>Yayınla</button></section><div id="design-error" role="alert"></div><div class="design-tabs">${Object.entries(tabs).map(([id, label]) => `<button data-design-tab="${id}" aria-pressed="${this.tab === id}">${label}</button>`).join('')}</div><div class="design-layout"><div class="design-form"><p class="muted">Taslak değişiklikler canlı kiosku etkilemez. Yayınlanan ayarlar, aktif işlem bittikten sonra uygulanır.</p><div id="design-fields"></div></div><section class="design-preview"><div class="toolbar"><select id="design-preview-page">${[['welcome', 'Karşılama'], ...d.pages.map(p => [p.id, p.title + (p.archived ? ' (arşiv)' : '')])].map(([id, title]) => `<option value="${id}" ${id === this.screen ? 'selected' : ''}>${esc(title)}</option>`).join('')}</select><select id="design-ratio"><option value="portrait">Dikey · 1080 × 1920</option><option value="landscape">Yatay · 1920 × 1080</option></select></div><div class="preview-stage"><iframe id="design-preview" title="Kiosk taslak önizlemesi" src="/kiosk-preview/" sandbox="allow-scripts allow-same-origin"></iframe></div><p class="muted">Gerçek kiosk bileşenleri · Önizlemede ödeme ve hesap işlemleri kapalı.</p></section></div>`;
        const box = this.host.querySelector('#design-fields'), f = this.field.bind(this), pageOptions = d.pages.filter(p => !p.archived).map(p => [p.id, p.title]), mediaOptions = [['', 'Mevcut / görsel yok'], ...d.media.map(m => [m.id, m.name])];
        if (this.tab === 'brand')
            box.innerHTML = f('Marka adı', 'brand.name') + f('Karşılama sloganı', 'brand.slogan') + f('Logo', 'brand.logo', 'text', mediaOptions) + f('Karşılama amblemi', 'brand.emblem', 'text', mediaOptions);
        if (this.tab === 'theme')
            box.innerHTML = `<p class="notice">Metin en az 14 px, işlem butonları en az 44 px olmalıdır. Renk değişiminden sonra açık ve koyu yüzeylerde okunabilirliği kontrol edin.</p>` + Object.entries({ bg: 'Sayfa', surface: 'Kart', elevated: 'Yükseltilmiş yüzey', border: 'Çerçeve', text: 'Ana metin', muted: 'Yardımcı metin', orange: 'Ana vurgu', blue: 'İkincil vurgu', green: 'Başarı', red: 'Hata' }).map(([k, l]) => f(l, 'theme.' + k, 'color')).join('') + f('Yazı tipi', 'theme.font', 'text', ['Segoe UI', 'Arial', 'Verdana', 'Georgia'].map(x => [x, x])) + [['fontSize', 'Temel yazı boyutu'], ['radius', 'Köşe yuvarlaklığı'], ['spacing', 'Bölüm boşluğu'], ['buttonHeight', 'Buton yüksekliği']].map(([k, l]) => f(l, 'theme.' + k, 'number')).join('') + '<button data-design="theme-reset">Tema varsayılanlarına dön</button>';
        if (this.tab === 'behavior')
            box.innerHTML = f('Başlangıç ekranı', 'behavior.start', 'text', pageOptions) + f('Varsayılan dil', 'behavior.language', 'text', [['tr', 'Türkçe'], ['en', 'English']]) + f('Etkileşimsizlik süresi (30–300 saniye)', 'behavior.idleSeconds', 'number') + f('Kampanya geçişi (2–30 saniye)', 'behavior.sliderSeconds', 'number') + f('Kampanyalar otomatik kaysın', 'behavior.autoplay', 'checkbox') + f('Animasyonlar', 'behavior.animations', 'checkbox') + f('Bakım modu (yeni girişleri kapatır)', 'behavior.maintenance', 'checkbox') + f('Bakım mesajı', 'behavior.maintenanceMessage') + `<p class="muted">Ödeme ve oturum güvenlik sınırları değişmez. Aktif oturum bakımdan etkilenmez.</p>`;
        if (this.tab === 'navigation')
            box.innerHTML = '<h2>Menü sırası</h2>' + d.navigation.map((n, i) => `<article class="design-row" draggable="true" data-design-drag="${i}" data-list="navigation">${f('Menü adı', `navigation.${i}.label`)}${f('Görünür', `navigation.${i}.visible`, 'checkbox')}${f('İkon', `navigation.${i}.icon`, 'text', ['home', 'topup', 'campaigns', 'history', 'profile', 'nfc', 'bolt', 'monitor', 'info'].map(x => [x, x]))}<div>${this.moves('navigation', i)}<span class="muted">${esc(n.id)}</span></div></article>`).join('');
        if (this.tab === 'navigation')
            box.innerHTML += '<h2>Hızlı erişim butonları</h2>' + (d.buttons || []).map((b, i) => `<article class="design-row">${f('Buton yazısı', `buttons.${i}.label`)}${f('Hedef ekran', `buttons.${i}.target`, 'text', pageOptions)}${f('Görünür', `buttons.${i}.visible`, 'checkbox')}${f('İkon', `buttons.${i}.icon`, 'text', ['arrow', 'plus', 'home', 'topup', 'campaigns', 'history', 'profile', 'monitor', 'info'].map(x => [x, x]))}</article>`).join('');
        if (this.tab === 'pages') {
            const p = d.pages.find(p => p.id === this.screen) || d.pages[0], i = d.pages.indexOf(p);
            this.screen = p.id;
            box.innerHTML = `<div class="toolbar"><button data-design="page-add">Ekran ekle</button><button data-design="page-copy">Çoğalt</button>${!['home', 'campaigns', 'topup', 'history', 'profile', 'games', 'computers'].includes(p.id) ? '<button data-design="page-archive">Arşivle / aç</button><button data-design="page-delete">Sil</button>' : ''}</div>${f('Ekran başlığı', `pages.${i}.title`)}<p class="muted">Hesap ve ödeme güvenlik alanları korunur. Sistem bölümleri kendi yerleşim grupları içinde sıralanır.</p>${(p.sections || []).map((section, j) => `<article class="design-row" draggable="true" data-design-drag="${j}" data-list="sections"><strong>${esc({ heading: 'Başlık', balance: 'Bakiye kartı', campaigns: 'Kampanyalar', quick: 'Hızlı erişim', recent: 'Son işlemler', coupons: 'Bonus kuponları' }[section.id])}</strong>${f('Görünür', `pages.${i}.sections.${j}.visible`, 'checkbox')}${this.moves('sections', j)}</article>`).join('')}<div class="toolbar"><select id="design-block-type"><option value="text">Metin</option><option value="image">Görsel / banner</option><option value="cards">Kart listesi</option><option value="action">Aksiyon</option></select><button data-design="block-add">Bölüm ekle</button></div>` + p.blocks.map((b, j) => `<article class="design-row" draggable="true" data-design-drag="${j}" data-list="blocks"><strong>${esc({ text: "Metin", image: "Görsel", action: "Aksiyon", cards: "Kart listesi" }[b.type])}</strong>${f('Başlık', `pages.${i}.blocks.${j}.title`)}<label>Metin (kart listesinde her satır bir kart)<textarea data-design-path="pages.${i}.blocks.${j}.text">${esc(b.text)}</textarea></label>${f('Görsel', `pages.${i}.blocks.${j}.mediaId`, 'text', mediaOptions)}${f('Buton yazısı', `pages.${i}.blocks.${j}.label`)}${f('Hedef ekran', `pages.${i}.blocks.${j}.target`, 'text', [['', 'Aksiyon yok'], ...pageOptions])}${f('Görünür', `pages.${i}.blocks.${j}.visible`, 'checkbox')}${f('Kolon sayısı', `pages.${i}.blocks.${j}.columns`, 'number')}${f('Hizalama', `pages.${i}.blocks.${j}.align`, 'text', [['left', 'Sol'], ['center', 'Orta'], ['right', 'Sağ']])}<div>${this.moves('blocks', j)}<button data-design="block-select" data-index="${j}">Önizlemede göster</button><button data-design="block-copy" data-index="${j}">Çoğalt</button><button data-design="block-delete" data-index="${j}">Sil</button></div></article>`).join('');
        }
        if (this.tab === 'texts')
            box.innerHTML = `<p>Metni seçerek Türkçe ve İngilizce karşılığını düzenleyin. Boş çeviride Türkçe kullanılır. Hesap verileri ve tutarlar bu listeye alınmaz.</p><input id="design-text-search" placeholder="Metin ara"><button data-design="text-add">Metin ekle</button><div id="design-text-list">${d.texts.map((t, i) => `<article class="design-row">${f('Kaynak metin', `texts.${i}.source`)}${f('Türkçe', `texts.${i}.tr`)}${f('English', `texts.${i}.en`)}</article>`).join('')}</div>`;
        if (this.tab === 'media')
            box.innerHTML = `<p>PNG, JPEG, WebP · dosya başına 1 MB · toplam yapılandırma 6 MB. Dosyalar taslakla birlikte veritabanında kalıcı saklanır.</p><input id="design-upload" type="file" accept="image/png,image/jpeg,image/webp"><progress id="design-upload-progress" max="100" value="0"></progress><input id="design-media-search" placeholder="Dosya ara">` + d.media.map((m, i) => `<article class="design-row design-media"><img src="${esc(m.data)}" alt="${esc(m.alt)}">${f('Ad', `media.${i}.name`)}${f('Alternatif metin', `media.${i}.alt`)}${f('Gösterim', `media.${i}.fit`, 'text', [['contain', 'Tamamını göster'], ['cover', 'Alanı doldur / kırp']])}${f('Odak X (%)', `media.${i}.focusX`, 'number')}${f('Odak Y (%)', `media.${i}.focusY`, 'number')}<p>${esc(this.uses(m.id).join(', ') || 'Kullanılmıyor')}</p><button data-design="media-delete" data-index="${i}">Sil</button></article>`).join('');
        if (this.tab === 'history') {
            box.innerHTML = '<p>Yükleniyor…</p>';
            api('kiosk-design/history').then(rows => { if (this.tab !== 'history')
                return; box.innerHTML = rows.length ? rows.map(v => `<article class="design-row"><strong>Sürüm ${v.sequence}</strong><p>${esc(v.actor)} · ${esc(date(v.created_at))}</p><button data-design="version-view" data-id="${v.id}">Taslağa al ve incele</button><button data-design="rollback" data-id="${v.id}" ${admin.role !== 'owner' ? 'disabled' : ''}>Bu sürümü yeniden yayınla</button></article>`).join('') : 'Henüz yayın yok.'; }).catch(e => this.error(e));
        }
        this.bind();
        this.host.querySelector('#design-preview').onload = () => this.preview();
        this.resizeObserver?.disconnect();
        this.resizeObserver = new ResizeObserver(() => this.resizePreview());
        this.resizeObserver.observe(this.host.querySelector('.preview-stage'));
        this.resizePreview();
        if (!canWrite())
            box.querySelectorAll('input,select,textarea,button').forEach(el => el.disabled = true);
    },
    resizePreview() { const stage = this.host?.querySelector('.preview-stage'), frame = stage?.querySelector('iframe'); if (!frame)
        return; const landscape = stage.classList.contains('landscape'), w = landscape ? 1920 : 1080, h = landscape ? 1080 : 1920, scale = Math.min(stage.clientWidth / w, 620 / h); frame.style.width = w + 'px'; frame.style.height = h + 'px'; frame.style.transform = 'scale(' + scale + ')'; frame.style.left = (stage.clientWidth - w * scale) / 2 + 'px'; stage.style.height = (h * scale) + 'px'; },
    moves(list, i) { return `<button data-design="move" data-list="${list}" data-index="${i}" data-offset="-1" aria-label="Yukarı taşı">↑</button><button data-design="move" data-list="${list}" data-index="${i}" data-offset="1" aria-label="Aşağı taşı">↓</button>`; },
    uses(id) { const d = this.draft.document; return [...Object.entries(d.brand).filter(([, v]) => v === id).map(([k]) => 'Marka / ' + k), ...d.pages.flatMap(p => p.blocks.filter(b => b.mediaId === id).map(b => p.title + ' / ' + b.title))]; },
    error(e) { const status = this.host?.querySelector('#design-status'); if (status)
        status.textContent = 'İşlem tamamlanamadı · değişiklikler taslakta korunuyor'; const el = this.host?.querySelector('#design-error'); if (el) {
        el.className = 'notice error';
        el.textContent = e.message;
    } },
    list(name) { return name === 'navigation' ? this.draft.document.navigation : this.draft.document.pages.find(p => p.id === this.screen)[name]; },
    move(name, from, to) { const list = this.list(name); if (to < 0 || to >= list.length)
        return; list.splice(to, 0, list.splice(from, 1)[0]); this.mark(); this.draw(); },
    bind() {
        this.host.oninput = event => { const input = event.target, path = input.dataset.designPath; if (path) {
            const parts = path.split('.'), key = parts.pop(), parent = parts.reduce((a, k) => a[k], this.draft.document);
            parent[key] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
            this.mark();
        } if (input.id === 'design-text-search' || input.id === 'design-media-search') {
            const scope = input.id === 'design-text-search' ? '#design-text-list .design-row' : '.design-media';
            this.host.querySelectorAll(scope).forEach(row => { row.hidden = !Array.from(row.querySelectorAll('input')).some(i => i.value.toLocaleLowerCase('tr').includes(input.value.toLocaleLowerCase('tr'))); });
        } };
        this.host.onchange = async (event) => { const input = event.target; if (input.id === 'design-preview-page') {
            this.screen = input.value;
            this.draw();
        } if (input.id === 'design-ratio') {
            this.host.querySelector('.preview-stage').classList.toggle('landscape', input.value === 'landscape');
            this.resizePreview();
        } if (input.id === 'design-upload' && input.files[0]) {
            try {
                const file = input.files[0];
                if (file.size > 1048576 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
                    throw Error('PNG, JPEG veya WebP seçin; en fazla 1 MB.');
                const data = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.onprogress = e => { this.host.querySelector('progress').value = e.lengthComputable ? e.loaded / e.total * 100 : 0; }; r.readAsDataURL(file); });
                this.draft.document.media.push({ id: uid(), name: file.name, alt: '', data, focusX: 50, focusY: 50, fit: 'contain' });
                this.mark();
                this.draw();
            }
            catch (e) {
                this.error(e);
            }
        } };
        this.host.ondragstart = e => { const row = e.target.closest('[data-design-drag]'); if (row) {
            this.drag = { list: row.dataset.list, index: Number(row.dataset.designDrag) };
            e.dataTransfer.setData('text/plain', 'section');
        } };
        this.host.ondragover = e => { if (e.target.closest('[data-design-drag]'))
            e.preventDefault(); };
        this.host.ondrop = e => { const row = e.target.closest('[data-design-drag]'); if (row && this.drag?.list === row.dataset.list) {
            e.preventDefault();
            this.move(this.drag.list, this.drag.index, Number(row.dataset.designDrag));
        } };
        this.host.onclick = async (event) => {
            const tab = event.target.closest('[data-design-tab]');
            if (tab) {
                this.tab = tab.dataset.designTab;
                this.draw();
                return;
            }
            const button = event.target.closest('[data-design]');
            if (!button)
                return;
            event.preventDefault();
            const action = button.dataset.design, d = this.draft.document, p = d.pages.find(p => p.id === this.screen), i = Number(button.dataset.index);
            try {
                if (action === 'reload') {
                    if (this.dirty && !confirm('Kaydedilmemiş değişiklikler bırakılacak. Devam?'))
                        return;
                    this.draft = await api('kiosk-design');
                    this.dirty = false;
                    this.draw();
                    return;
                }
                if (['save', 'publish'].includes(action)) {
                    if (action === 'publish' && !confirm('Taslağı tüm bağlı kiosklarda yayınla?'))
                        return;
                    button.disabled = true;
                    this.host.querySelector('#design-status').textContent = 'Kaydediliyor…';
                    this.draft = await api('kiosk-design/' + action, this.draft);
                    this.dirty = false;
                    this.draw();
                    return;
                }
                if (action === 'move') {
                    this.move(button.dataset.list, i, i + Number(button.dataset.offset));
                    return;
                }
                if (action === 'theme-reset') {
                    if (!confirm('Tema varsayılanlarına dönülsün mü?'))
                        return;
                    d.theme = { bg: '#090c12', surface: '#131923', elevated: '#1b2330', border: '#263142', text: '#f5f7fc', muted: '#9ba8bb', orange: '#ffaa16', blue: '#48b9ff', green: '#63d8a0', red: '#ff8692', font: 'Segoe UI', fontSize: 16, radius: 12, spacing: 20, buttonHeight: 54 };
                }
                if (action === 'page-add' || action === 'page-copy') {
                    const id = 'page-' + uid().slice(0, 8), newPage = action === 'page-copy' ? structuredClone(p) : { title: 'Yeni ekran', blocks: [], archived: false };
                    newPage.id = id;
                    newPage.title += ' (yeni)';
                    newPage.blocks.forEach(b => b.id = uid());
                    d.pages.push(newPage);
                    d.navigation.push({ id, label: newPage.title, visible: true });
                    this.screen = id;
                }
                if (action === 'page-delete' || action === 'page-archive') {
                    if (d.behavior.start === p.id || (d.buttons || []).some(b => b.target === p.id) || d.pages.some(x => x.blocks.some(b => b.target === p.id)))
                        throw Error('Bu ekran başlangıç ekranı veya bir bölümün hedefi. Önce bağlantıları değiştirin.');
                    if (!confirm('Ekran menüden kaldırılacak. Devam edilsin mi?'))
                        return;
                    d.navigation = d.navigation.filter(n => n.id !== p.id);
                    if (action === 'page-delete') {
                        d.pages = d.pages.filter(x => x !== p);
                        this.screen = 'home';
                    }
                    else {
                        p.archived = !p.archived;
                        if (!p.archived)
                            d.navigation.push({ id: p.id, label: p.title, visible: true });
                    }
                }
                if (action === 'block-add')
                    p.blocks.push({ id: uid(), type: this.host.querySelector('#design-block-type').value, title: 'Yeni bölüm', text: '', mediaId: '', target: '', label: '', visible: true, columns: 1, align: 'left' });
                if (action === 'block-copy')
                    p.blocks.splice(i + 1, 0, { ...structuredClone(p.blocks[i]), id: uid() });
                if (action === 'block-delete') {
                    if (!confirm('Bölüm silinsin mi?'))
                        return;
                    p.blocks.splice(i, 1);
                }
                if (action === 'block-select') {
                    this.selected = p.blocks[i].id;
                    this.preview();
                    return;
                }
                if (action === 'media-delete') {
                    if (this.uses(d.media[i].id).length)
                        throw Error('Kullanımdaki dosya silinemez: ' + this.uses(d.media[i].id).join(', '));
                    d.media.splice(i, 1);
                }
                if (action === 'text-add')
                    d.texts.push({ source: '', tr: '', en: '' });
                if (action === 'version-view') {
                    if (this.dirty && !confirm('Kaydedilmemiş taslak değişiklikleri bırakılacak. Devam?'))
                        return;
                    this.draft.document = (await api('kiosk-design/history/' + button.dataset.id)).document;
                    this.tab = 'brand';
                }
                if (action === 'rollback') {
                    if (!confirm('İçerik, tema ve ekran düzeni birlikte bu sürüme dönecek. Yayınlansın mı?'))
                        return;
                    this.draft = await api('kiosk-design/rollback', { id: button.dataset.id, revision: this.draft.revision });
                    this.dirty = false;
                    this.draw();
                    return;
                }
                this.mark();
                this.draw();
            }
            catch (e) {
                this.error(e);
                button.disabled = false;
            }
        };
    }
};
window.addEventListener('beforeunload', e => { if (kioskEditor.dirty) {
    e.preventDefault();
    e.returnValue = '';
} });
document.addEventListener('click', e => { if (kioskEditor.dirty && e.target.closest('aside [data-page], [data-action="logout"], [data-action="refresh"]') && !confirm('Taslak kaydedilmedi. Bu ekrandan ayrılmak istiyor musun?'))
    e.stopImmediatePropagation(); }, true);
