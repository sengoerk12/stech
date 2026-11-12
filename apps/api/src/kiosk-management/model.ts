import { textCatalog } from './text-catalog';
import { BadRequestException } from '@nestjs/common';
export const screens = ['home', 'campaigns', 'topup', 'history', 'profile', 'games', 'computers'];
export const defaults = () => ({ schemaVersion: 1, buttons: [{ id: 'go-topup', label: 'Bakiye yükle', icon: 'plus', visible: true, target: 'topup' }, { id: 'go-profile', label: 'Hesabımı görüntüle', icon: 'arrow', visible: true, target: 'profile' }, { id: 'go-history', label: 'Tümünü gör', icon: 'arrow', visible: true, target: 'history' }], brand: { name: 'S TECH', slogan: 'Oyun burada başlar', logo: '', emblem: '' }, theme: { bg: '#090c12', surface: '#131923', elevated: '#1b2330', border: '#263142', text: '#f5f7fc', muted: '#9ba8bb', orange: '#ffaa16', blue: '#48b9ff', green: '#63d8a0', red: '#ff8692', font: 'Segoe UI', fontSize: 16, radius: 12, spacing: 20, buttonHeight: 54 }, behavior: { start: 'home', language: 'tr', idleSeconds: 90, sliderSeconds: 4, autoplay: true, animations: true, maintenance: false, maintenanceMessage: 'Kısa bir bakım arasındayız. Lütfen daha sonra tekrar gel.', offlineMessage: 'Bağlantı kurulamadı. Son güncel içerik gösteriliyor.' }, navigation: ['computers', 'campaigns', 'topup', 'home', 'history', 'profile', 'games'].map((id, i) => ({ id, icon: ({ computers: 'monitor', campaigns: 'campaigns', topup: 'topup', home: 'home', history: 'history', profile: 'profile', games: 'bolt' } as Record<string, string>)[id], label: ['Bilgisayarlar', 'Kampanyalar', 'Bakiye yükle', 'Ana ekran', 'İşlem geçmişi', 'Profilim', 'Oyunlar'][i], visible: true })), texts: structuredClone(textCatalog), pages: screens.map(id => ({ id, title: ({ home: 'Ana ekran', campaigns: 'Kampanyalar', topup: 'Bakiye yükle', history: 'İşlem geçmişi', profile: 'Profilim', games: 'Oyunlar', computers: 'Bilgisayarlar' } as Record<string, string>)[id], archived: false, sections: (id === 'home' ? ['heading', 'balance', 'campaigns', 'quick', 'recent'] : id === 'topup' ? ['heading', 'coupons'] : ['heading']).map(id => ({ id, visible: true })), blocks: [] as any[] })), media: [] as any[] });
const fail = (field: string): never => { throw new BadRequestException(field + ': Geçersiz veya eksik değer.'); };
function validateInternal(input: any): ReturnType<typeof defaults> {
    if (!input || typeof input !== 'object' || JSON.stringify(input).length > 6000000)
        fail('Yapılandırma');
    const d = structuredClone(input);
    if (d.schemaVersion !== 1)
        fail('Şema sürümü');
    const str = (v: any, f: string, max = 500) => { if (typeof v !== 'string' || v.length > max)
        fail(f); };
    const num = (v: any, f: string, min: number, max: number) => { if (!Number.isInteger(v) || v < min || v > max)
        fail(f); };
    const bool = (v: any, f: string) => { if (typeof v !== 'boolean')
        fail(f); };
    if (!d.brand || !d.theme || !d.behavior)
        fail('Genel ayarlar');
    for (const k of ['name', 'slogan', 'logo', 'emblem'])
        str(d.brand[k], 'Marka / ' + k);
    if (!d.brand.name.trim())
        fail('Marka adı');
    for (const k of ['bg', 'surface', 'elevated', 'border', 'text', 'muted', 'orange', 'blue', 'green', 'red'])
        if (!/^#[0-9a-f]{6}$/i.test(d.theme[k]))
            fail('Renk / ' + k);
    if (!['Segoe UI', 'Arial', 'Verdana', 'Georgia'].includes(d.theme.font))
        fail('Yazı tipi');
    num(d.theme.fontSize, 'Yazı boyutu', 14, 28);
    num(d.theme.radius, 'Köşe', 0, 32);
    num(d.theme.spacing, 'Boşluk', 8, 40);
    num(d.theme.buttonHeight, 'Dokunma alanı', 44, 80);
    num(d.behavior.idleSeconds, 'Oturum süresi', 30, 300);
    num(d.behavior.sliderSeconds, 'Slider süresi', 2, 30);
    for (const k of ['autoplay', 'animations', 'maintenance'])
        bool(d.behavior[k], k);
    for (const k of ['maintenanceMessage', 'offlineMessage'])
        str(d.behavior[k], k);
    if (!['tr', 'en'].includes(d.behavior.language))
        fail('Dil');
    if (!Array.isArray(d.pages) || d.pages.length > 40)
        fail('Ekranlar');
    const ids = new Set<string>();
    for (const p of d.pages) {
        if (!/^[a-z][a-z0-9-]{0,49}$/.test(p.id) || ids.has(p.id))
            fail('Ekran kimliği');
        ids.add(p.id);
        str(p.title, 'Ekran başlığı', 100);
        bool(p.archived, 'Arşiv');
        if (screens.includes(p.id) && p.archived)
            fail('Sistem ekranı arşivlenemez');
        if (p.sections !== undefined) {
            if (!Array.isArray(p.sections) || p.sections.length > 10 || new Set(p.sections.map((x: any) => x.id)).size !== p.sections.length)
                fail('Bölüm düzeni');
            for (const section of p.sections) {
                if (!['heading', 'balance', 'campaigns', 'quick', 'recent', 'coupons'].includes(section.id))
                    fail('Sistem bölümü');
                bool(section.visible, 'Bölüm görünürlüğü');
            }
        }
        if (!Array.isArray(p.blocks) || p.blocks.length > 40)
            fail('Bölümler');
        const blockIds = new Set();
        for (const b of p.blocks) {
            if (typeof b.id !== 'string' || blockIds.has(b.id))
                fail('Bölüm kimliği');
            blockIds.add(b.id);
            if (!['text', 'image', 'action', 'cards'].includes(b.type))
                fail('Bölüm türü');
            str(b.title, 'Bölüm başlığı', 150);
            str(b.text, 'Bölüm metni', 2000);
            str(b.mediaId, 'Medya');
            str(b.target, 'Hedef');
            str(b.label, 'Buton metni', 80);
            bool(b.visible, 'Görünürlük');
            num(b.columns, 'Kolon', 1, 3);
            if (!['left', 'center', 'right'].includes(b.align))
                fail('Hizalama');
        }
    }
    for (const id of screens)
        if (!ids.has(id))
            fail('Sistem ekranı eksik: ' + id);
    const icons = ['home', 'topup', 'campaigns', 'history', 'profile', 'arrow', 'logout', 'nfc', 'check', 'close', 'shield', 'bolt', 'plus', 'back', 'monitor', 'info'];
    const active = (id: string) => d.pages.some((p: any) => p.id === id && !p.archived);
    if (d.buttons !== undefined) {
        if (!Array.isArray(d.buttons) || d.buttons.length !== 3 || new Set(d.buttons.map((b: any) => b.id)).size !== 3)
            fail('Butonlar');
        for (const b of d.buttons) {
            if (!['go-topup', 'go-profile', 'go-history'].includes(b.id) || !icons.includes(b.icon) || !active(b.target))
                fail('Buton hedefi / ikonu');
            str(b.label, 'Buton yazısı', 80);
            bool(b.visible, 'Buton görünürlüğü');
        }
    }
    if (!active(d.behavior.start))
        fail('Başlangıç ekranı');
    if (!Array.isArray(d.navigation) || d.navigation.length > 40 || new Set(d.navigation.map((n: any) => n.id)).size !== d.navigation.length)
        fail('Menü');
    for (const n of d.navigation) {
        if (n.icon !== undefined && !icons.includes(n.icon))
            fail('Menü ikonu');
        if (!active(n.id))
            fail('Menü hedefi: ' + n.id);
        str(n.label, 'Menü adı', 60);
        bool(n.visible, 'Menü görünürlüğü');
    }
    if (!d.navigation.some((n: any) => n.visible && n.id === d.behavior.start))
        fail('Başlangıç ekranı menüde görünür olmalı');
    if (!Array.isArray(d.texts) || d.texts.length > 1000)
        fail('Metinler');
    for (const t of d.texts)
        for (const k of ['source', 'tr', 'en'])
            str(t[k], 'Çeviri', 2000);
    if (!Array.isArray(d.media) || d.media.length > 40)
        fail('Medya (en fazla 40)');
    const mediaIds = new Set();
    for (const m of d.media) {
        if (typeof m.id !== 'string' || mediaIds.has(m.id))
            fail('Medya kimliği');
        mediaIds.add(m.id);
        str(m.name, 'Dosya adı', 120);
        str(m.alt, 'Alternatif metin', 300);
        num(m.focusX, 'Odak X', 0, 100);
        num(m.focusY, 'Odak Y', 0, 100);
        if (!['contain', 'cover'].includes(m.fit))
            fail('Görsel gösterimi');
        if (typeof m.data !== 'string' || m.data.length > 1800000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(m.data))
            fail('Medya: PNG, JPEG veya WebP, en fazla 1 MB');
        const raw = Buffer.from(m.data.split(',')[1], 'base64');
        const valid = m.data.startsWith('data:image/png') ? raw.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' : m.data.startsWith('data:image/jpeg') ? raw[0] === 255 && raw[1] === 216 : raw.subarray(0, 4).toString() === 'RIFF' && raw.subarray(8, 12).toString() === 'WEBP';
        if (!valid || raw.length > 1048576)
            fail('Dosya içeriği');
    }
    for (const k of ['logo', 'emblem'])
        if (d.brand[k] && !mediaIds.has(d.brand[k]))
            fail('Marka görseli bulunamadı');
    for (const p of d.pages)
        for (const b of p.blocks) {
            if (b.mediaId && !mediaIds.has(b.mediaId))
                fail('Kullanılan medya silinemez');
            if (b.target && !active(b.target))
                fail('Bölüm hedefi: ' + b.target);
            if (b.type === 'action' && (!b.target || !b.label))
                fail('Aksiyon hedefi ve yazısı');
        }
    return d;
}
export function validate(input: any): ReturnType<typeof defaults> { try {
    return validateInternal(input);
}
catch (error) {
    if (error instanceof BadRequestException)
        throw error;
    throw new BadRequestException('Yapılandırma alanları eksik veya geçersiz.');
} }
