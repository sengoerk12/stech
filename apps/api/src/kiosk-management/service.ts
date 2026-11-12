import { ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Database } from '../database/database';
import { defaults, validate } from './model';
export class KioskManagement {
    constructor(private db: Database) { }
    async init() { await this.db.query(`INSERT INTO kiosk_design_state(id,revision,document) VALUES(1,0,$1) ON CONFLICT DO NOTHING`, [defaults()]); }
    async draft() { return (await this.db.query<any>('SELECT revision,document FROM kiosk_design_state WHERE id=1')).rows[0]; }
    async published() { return (await this.db.query<any>('SELECT id,document,created_at FROM kiosk_design_versions ORDER BY sequence DESC LIMIT 1')).rows[0] ?? { id: 'default', document: defaults() }; }
    async history() { return (await this.db.query('SELECT id,sequence,actor,created_at FROM kiosk_design_versions ORDER BY sequence DESC LIMIT 100')).rows; }
    async version(id: string) { if (!/^[0-9a-f-]{36}$/.test(id))
        throw new NotFoundException('Sürüm bulunamadı.'); const v = (await this.db.query<any>('SELECT * FROM kiosk_design_versions WHERE id=$1', [id])).rows[0]; if (!v)
        throw new NotFoundException('Sürüm bulunamadı.'); return v; }
    async save(body: any, actor: string, publish = false) {
        const doc = validate(body?.document);
        const revision = body?.revision;
        if (!Number.isSafeInteger(revision))
            throw new ConflictException('Taslağı yeniden yükleyin.');
        return this.db.transaction(async (tx) => {
            const saved = await tx.query('UPDATE kiosk_design_state SET document=$1,revision=revision+1 WHERE id=1 AND revision=$2 RETURNING revision', [doc, revision]);
            if (!saved.rows.length)
                throw new ConflictException('Başka bir yönetici bu taslağı değiştirdi. Değişikliklerini kopyalayıp yeniden yükle.');
            const id = randomUUID();
            if (publish)
                await tx.query('INSERT INTO kiosk_design_versions(id,document,actor) VALUES($1,$2,$3)', [id, doc, actor]);
            await tx.query('INSERT INTO audit_logs(id,event,resource_id,metadata) VALUES($1,$2,$3,$4)', [randomUUID(), publish ? 'kiosk.design.published' : 'kiosk.design.saved', id, { actor }]);
            return { ...saved.rows[0], document: doc };
        });
    }
    async rollback(body: any, actor: string) { const old = await this.version(String(body?.id)); return this.save({ revision: body.revision, document: old.document }, actor, true); }
}
