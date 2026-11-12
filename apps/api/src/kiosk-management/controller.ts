import { Controller, Get, Post, Body, Req, Param, Headers, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AdminService } from '../admin/service';
import type { KioskManagement } from './service';
export function createKioskManagementController(service: KioskManagement, admin: AdminService) {
    @Controller()
    class KioskManagementController {
        @Get('kiosk/design')
        async publicDesign(
        @Headers('if-none-match')
        etag: string | undefined,
        @Res({ passthrough: true })
        response: Response) { const published = await service.published(); const tag = '"' + published.id + '"'; response.setHeader('ETag', tag); response.setHeader('Cache-Control', 'no-cache'); if (etag === tag) {
            response.status(304);
            return;
        } return published; }
        @Get('admin/kiosk-design')
        async draft(
        @Req()
        r: Request) { await admin.authorize(r.headers.authorization); return service.draft(); }
        @Get('admin/kiosk-design/history')
        async history(
        @Req()
        r: Request) { await admin.authorize(r.headers.authorization); return service.history(); }
        @Get('admin/kiosk-design/history/:id')
        async version(
        @Req()
        r: Request,
        @Param('id')
        id: string) { await admin.authorize(r.headers.authorization); return service.version(id); }
        @Post('admin/kiosk-design/save')
        async save(
        @Req()
        r: Request,
        @Body()
        b: unknown) { const a = await admin.authorize(r.headers.authorization, true); return service.save(b, a.username); }
        @Post('admin/kiosk-design/publish')
        async publish(
        @Req()
        r: Request,
        @Body()
        b: unknown) { const a = await admin.authorize(r.headers.authorization, true, true); return service.save(b, a.username, true); }
        @Post('admin/kiosk-design/rollback')
        async rollback(
        @Req()
        r: Request,
        @Body()
        b: unknown) { const a = await admin.authorize(r.headers.authorization, true, true); return service.rollback(b, a.username); }
    }
    return KioskManagementController;
}
