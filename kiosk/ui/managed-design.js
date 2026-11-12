'use strict';
// This module never receives authentication, balance or payment secrets.
window.kioskDesign = {
    config: null, version: null, originalNav: null,
    navigation(nav, original) {
        this.originalNav ||= structuredClone(original);
        if (!this.config)
            return;
        nav.splice(0, nav.length, ...this.config.navigation.filter(n => n.visible).map(n => ({ ...n, icon: n.icon || this.originalNav.find(o => o.id === n.id)?.icon || 'info' })));
    },
    accept(envelope) {
        const d = envelope?.document;
        try {
            if (!d?.brand || !Array.isArray(d.texts) || !Array.isArray(d.media) || !Array.isArray(d.navigation) || !Array.isArray(d.pages) || !d.behavior || !d.theme)
                return false;
            if (d.media.some(m => !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(m.data)))
                return false;
            if (d.navigation.some(n => !(/^[a-z][a-z0-9-]{0,49}$/).test(n.id) || typeof n.label !== 'string' || typeof n.visible !== 'boolean'))
                return false;
            if (d.pages.some(p => !Array.isArray(p.blocks) || p.blocks.some(b => typeof b.text !== 'string' || !['text', 'image', 'action', 'cards'].includes(b.type))))
                return false;
            if ((d.buttons || []).some(b => !['go-topup', 'go-profile', 'go-history'].includes(b.id) || !d.pages.some(p => p.id === b.target)))
                return false;
            if (!['Segoe UI', 'Arial', 'Verdana', 'Georgia'].includes(d.theme.font) || !Number.isInteger(d.theme.fontSize) || d.theme.fontSize < 14 || d.theme.fontSize > 28)
                return false;
        }
        catch {
            return false;
        }
        if (!d || d.schemaVersion !== 1 || !Array.isArray(d.pages) || !Array.isArray(d.navigation) || !d.theme || !d.behavior || !Array.isArray(d.media))
            return false;
        if (Object.entries(d.theme).some(([k, v]) => ['bg', 'surface', 'elevated', 'border', 'text', 'muted', 'orange', 'blue', 'green', 'red'].includes(k) && !/^#[0-9a-f]{6}$/i.test(v)))
            return false;
        this.config = d;
        this.version = envelope.id;
        return true;
    },
    apply(root, page) {
        const d = this.config;
        if (!d)
            return;
        const style = document.documentElement.style;
        for (const k of ['bg', 'surface', 'elevated', 'border', 'text', 'muted', 'orange', 'blue', 'green', 'red'])
            style.setProperty('--' + k, d.theme[k]);
        style.fontFamily = d.theme.font;
        style.fontSize = '16px';
        if(d.theme.fontSize!==16){const elements=[...root.querySelectorAll('h1,h2,h3,h4,p,span,small,button,label,strong')];const sizes=elements.map(el=>parseFloat(getComputedStyle(el).fontSize));elements.forEach((el,i)=>el.style.fontSize=(sizes[i]*d.theme.fontSize/16)+'px');}
        if(d.theme.radius!==12)root.querySelectorAll('.panel,.button,.balance-card,.bonus-coupon').forEach(el=>el.style.borderRadius=d.theme.radius+'px');
        if(d.theme.spacing!==20)root.querySelectorAll('.panel,.managed-block').forEach(el=>el.style.padding=d.theme.spacing+'px');
        const breadcrumb=root.querySelector('.breadcrumb');if(breadcrumb?.firstChild?.nodeType===Node.TEXT_NODE)breadcrumb.firstChild.textContent=d.brand.name+' ';

        style.setProperty('--managed-radius', d.theme.radius + 'px');
        style.setProperty('--managed-spacing', d.theme.spacing + 'px');
        style.setProperty('--managed-button', d.theme.buttonHeight + 'px');
        document.documentElement.classList.toggle('managed-no-motion', !d.behavior.animations);
        document.documentElement.lang = d.behavior.language;
        if (d.theme.buttonHeight !== 54)
            root.querySelectorAll('.button').forEach(button => button.style.minHeight = d.theme.buttonHeight + 'px');
        const media = id => d.media.find(m => m.id === id);
        for (const [key, selector] of [['logo', '.brand-wordmark'], ['emblem', '.hero-emblem']]) {
            const m = media(d.brand[key]);
            root.querySelectorAll(selector).forEach(img => { if (m) {
                img.src = m.data;
                img.alt = m.alt || d.brand.name;
            }
            else
                img.alt = d.brand.name; });
        }
        const slogan = root.querySelector('.welcome-copy .eyebrow');
        if (slogan)
            slogan.textContent = d.brand.slogan;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const texts = new Map(d.texts.map(t => [t.source, t[d.behavior.language] || t.tr || t.source]));
        let node;
        while (node = walker.nextNode()) {
            const t = node.textContent.trim();
            if (texts.has(t) && !node.parentElement.closest('script,input,textarea'))
                node.textContent = node.textContent.replace(t, texts.get(t));
        }
        for (const spec of d.buttons || []) {
            for (const button of root.querySelectorAll('[data-action="' + spec.id + '"]')) {
                button.hidden = !spec.visible;
                button.removeAttribute('data-action');
                button.dataset.page = spec.target;
                button.innerHTML = icon(spec.icon) + ' ' + e(spec.label);
            }
        }
        const host = root.querySelector('.content');
        if (host) {
            const p = d.pages.find(p => p.id === page && !p.archived);
            if (p) {
                const defaultTitles={home:'Ana ekran',campaigns:'Kampanyalar',topup:'Bakiye yükle',history:'İşlem geçmişi',profile:'Profilim',games:'Oyunlar',computers:'Bilgisayarlar'};
                const heading=host.querySelector('.page-heading h1');
                if(heading&&p.title!==defaultTitles[p.id])heading.textContent=p.title;
                if(!defaultTitles[p.id]){const h=document.createElement('h1');h.textContent=p.title;host.prepend(h);}
                const selectors = { heading: '.page-heading', balance: '.balance-card', campaigns: '.home-campaigns, .no-campaign', quick: '.quick-strip', recent: '.recent', coupons: '.campaign-picker' };
                for (const spec of p.sections || []) {
                    const element = host.querySelector(selectors[spec.id]);
                    if (element)
                        element.hidden = !spec.visible;
                }
                const ordered = (p.sections || []).map(spec => host.querySelector(selectors[spec.id])).filter(Boolean);
                const groups = new Map();
                for (const el of ordered) {
                    const parent = el.parentElement;
                    if (!groups.has(parent))
                        groups.set(parent, []);
                    groups.get(parent).push(el);
                }
                for (const [parent, items] of groups) {
                    const positions = [...parent.children].filter(el => items.includes(el));
                    if (positions.length > 1) {
                        const markers = positions.map(el => { const marker = document.createComment('section'); el.replaceWith(marker); return marker; });
                        markers.forEach((marker, i) => marker.replaceWith(items[i]));
                    }
                }
                const section = document.createElement('div');
                section.className = 'managed-blocks';
                for (const b of p.blocks.filter(b => b.visible)) {
                    const article = document.createElement('section');
                    article.className = 'panel managed-block';
                    article.dataset.blockId = b.id;
                    article.style.textAlign = b.align;
                    const title = document.createElement('h2');
                    title.textContent = b.title;
                    article.append(title);
                    const m = media(b.mediaId);
                    if (m) {
                        const img = document.createElement('img');
                        img.src = m.data;
                        img.alt = m.alt;
                        img.style.objectFit = m.fit;
                        img.style.objectPosition = m.focusX + '% ' + m.focusY + '%';
                        article.append(img);
                    }
                    if (b.type === 'cards') {
                        const grid = document.createElement('div');
                        grid.className = 'managed-cards';
                        grid.style.gridTemplateColumns = `repeat(${b.columns},minmax(0,1fr))`;
                        for (const text of b.text.split('\n').filter(Boolean)) {
                            const card = document.createElement('p');
                            card.textContent = text;
                            grid.append(card);
                        }
                        article.append(grid);
                    }
                    else {
                        const text = document.createElement('p');
                        text.textContent = b.text;
                        article.append(text);
                    }
                    if (b.target) {
                        const button = document.createElement('button');
                        button.className = 'button primary';
                        button.dataset.page = b.target;
                        button.textContent = b.label || 'İncele';
                        article.append(button);
                    }
                    section.append(article);
                }
                host.append(section);
            }
        }
        if (d.behavior.maintenance && page === 'welcome') {
            const main = root.querySelector('main');
            if (main) {
                main.replaceChildren();
                const h = document.createElement('h1');
                h.textContent = d.behavior.maintenanceMessage;
                main.append(h);
            }
        }
    },
    async refresh() {
        if (location.pathname.startsWith('/kiosk-preview'))
            return;
        try {
            const response = await window.stech.call('design');
            if (response.ok && response.data?.id !== this.version) {
                // Defer updates until the active member has finished; never re-render a payment or game.
                if (typeof state !== 'undefined' && state.data)
                    return;
                if (this.accept(response.data)) {
                    try {
                        localStorage.setItem('stech-published-design-v1', JSON.stringify(response.data));
                    }
                    catch { }
                    if (typeof render === 'function')
                        render();
                }
            }
        }
        catch { }
    }
};
try {
    const cached = JSON.parse(localStorage.getItem('stech-published-design-v1') || 'null');
    if (cached)
        window.kioskDesign.accept(cached);
}
catch { }
if (location.pathname.startsWith('/kiosk-preview')) {
    // Isolated preview: no device key, no real account and no transactional requests.
    window.stech = { on: () => () => { }, call: async (action) => ({ ok: true, data: action === 'info' ? { mode: 'demo', station: 'TASLAK ÖNİZLEME' } : null }) };
    window.addEventListener('message', event => {
        if (event.source !== parent || event.origin !== location.origin || event.data?.type !== 'stech-preview')
            return;
        if (!window.kioskDesign.accept({ id: 'preview', document: event.data.document }))
            return;
        state.info = { mode: 'demo', station: 'ÖNİZLEME' };
        state.data = event.data.page === 'welcome' ? null : { member: { name: 'Önizleme Üyesi', username: 'onizleme' }, wallet: { balance: 0 }, promotions: [], transactions: [], features: {}, announcements: [] };
        state.page = event.data.page || 'home';
        render();
        if (event.data.blockId)
            document.querySelector(`[data-block-id="${CSS.escape(event.data.blockId)}"]`)?.classList.add('managed-selected');
    });
    document.addEventListener('click', event => { if (event.target.closest('[data-action]'))
        event.stopImmediatePropagation(); }, true);
}
else {
    setTimeout(() => window.kioskDesign.refresh(), 1000);
    setInterval(() => window.kioskDesign.refresh(), 15000);
}
