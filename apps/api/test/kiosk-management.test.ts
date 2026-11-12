import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app';
import { defaults, validate } from '../src/kiosk-management/model';
test('design validation rejects broken references, unsafe media, undersized controls and missing fields', () => {
    assert.doesNotThrow(() => validate(defaults()));
    for (const mutate of [(d: any) => d.theme.fontSize = 3, (d: any) => d.theme.bg = 'url(javascript:evil)', (d: any) => d.navigation[0].id = 'missing', (d: any) => d.pages.pop(), (d: any) => d.brand.logo = 'missing', (d: any) => d.behavior.idleSeconds = 9999]) {
        const d = defaults();
        mutate(d);
        assert.throws(() => validate(d));
    }
    assert.throws(() => validate({ schemaVersion: 1 }));
    const d = defaults();
    d.media.push({ id: 'x', name: 'bad.png', alt: '', focusX: 50, focusY: 50, fit: 'contain', data: 'data:image/png;base64,SGVsbG8=' });
    assert.throws(() => validate(d));
});
test('draft isolation, authorization, atomic publishing, conflict detection, restore and audit', async () => {
    const app = await createApp({ ENVIRONMENT: 'test', ADMIN_SETUP_TOKEN: 'design-setup', DEMO_PASSWORD: 'member-pass' });
    try {
        await app.listen(0, '127.0.0.1');
        const base = await app.getUrl();
        let token = '';
        const call = (route: string, body?: unknown) => fetch(base + '/api/v1/' + route, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Setup-Token': 'design-setup', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
        assert.equal((await call('admin/kiosk-design')).status, 401);
        assert.equal((await call('admin/kiosk-design/publish', {})).status, 401);
        const credentials = { username: 'designowner', password: 'Strong-password-123!' };
        assert.equal((await call('admin/auth/setup', credentials)).status, 201);
        token = (await (await call('admin/auth/login', credentials)).json()).token;
        const owner = token;
        let draft = await (await call('admin/kiosk-design')).json();
        const initial = await (await call('kiosk/design')).json();
        draft.document.brand.name = 'New brand';
        draft.document.theme.blue = '#1122ff';
        const saved = await call('admin/kiosk-design/save', draft);
        assert.equal(saved.status, 201);
        const updated = await saved.json();
        assert.equal((await (await call('kiosk/design')).json()).document.brand.name, initial.document.brand.name);
        assert.equal((await call('admin/kiosk-design/save', draft)).status, 409);
        draft = updated;
        assert.equal((await call('admin/kiosk-design/publish', draft)).status, 201);
        const published = await (await call('kiosk/design')).json();
        assert.equal(published.document.brand.name, 'New brand');
        draft = await (await call('admin/kiosk-design')).json();
        draft.document.brand.name = 'Version two';
        draft = await (await call('admin/kiosk-design/publish', draft)).json();
        assert.equal((await call('admin/kiosk-design/rollback', { id: published.id, revision: draft.revision })).status, 201);
        assert.equal((await (await call('kiosk/design')).json()).document.brand.name, 'New brand');
        assert.equal((await (await call('admin/kiosk-design/history')).json()).length, 3);
        draft = await (await call('admin/kiosk-design')).json();
        draft.document.brand.logo = 'missing';
        assert.equal((await call('admin/kiosk-design/publish', draft)).status, 400);
        for (const role of ['viewer', 'operator']) {
            const user = { username: role + 'design', password: 'Strong-password-123!', role };
            token = owner;
            assert.equal((await call('admin/accounts', user)).status, 201);
            token = (await (await call('admin/auth/login', user)).json()).token;
            assert.equal((await call('admin/kiosk-design')).status, 200);
            assert.equal((await call('admin/kiosk-design/publish', draft)).status, 403);
            if (role === 'viewer')
                assert.equal((await call('admin/kiosk-design/save', draft)).status, 403);
        }
        token = owner;
        const audit = await (await call('admin/audit')).json();
        assert.match(JSON.stringify(audit), /kiosk.design.published/);
    }
    finally {
        await app.close();
    }
});
