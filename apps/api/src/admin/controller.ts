import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import type { AdminService } from "./service";
export function createAdminController(service: AdminService) {
  @Controller("admin")
  class AdminController {
    @Get("auth/status") status() {
      return service.status();
    }
    @Post("auth/setup") setup(@Req() req: Request, @Body() body: unknown) {
      return service.setup(
        body,
        String(req.headers["x-setup-token"] ?? ""),
        req.socket.remoteAddress ?? "",
      );
    }
    @Post("auth/login") login(@Body() body: unknown) {
      return service.login(body);
    }
    @Post("auth/logout") async logout(@Req() req: Request) {
      await service.authorize(req.headers.authorization, false, false, true);
      return service.logout(req.headers.authorization!);
    }
    @Get("me") me(@Req() req: Request) {
      return service.authorize(req.headers.authorization, false, false, true);
    }
    @Post("auth/password") async password(
      @Req() req: Request,
      @Body() body: unknown,
    ) {
      const actor = await service.authorize(req.headers.authorization);
      return service.changePassword(actor, body);
    }
    @Get("overview") async overview(@Req() req: Request) {
      await service.authorize(req.headers.authorization);
      return service.overview();
    }
    @Get("members") async members(
      @Req() req: Request,
      @Query("search") search?: string,
      @Query("after") after?: string,
      @Query("field") field?: string,
    ) {
      await service.authorize(req.headers.authorization);
      return service.members(search, after, field);
    }
    @Get("members/:id") async member(
      @Req() req: Request,
      @Param("id") id: string,
      @Query("username") username: string,
    ) {
      await service.authorize(req.headers.authorization);
      return service.memberDetail(id, username);
    }
    @Post("adjustments") async adjust(
      @Req() req: Request,
      @Body() body: unknown,
    ) {
      const actor = await service.authorize(req.headers.authorization, true);
      return service.adjust(actor, body);
    }
    @Get("adjustments") async adjustments(@Req() req: Request) {
      await service.authorize(req.headers.authorization);
      return service.adjustments();
    }
    @Get("promotions") async promotions(@Req() req: Request) {
      await service.authorize(req.headers.authorization);
      return service.promotions();
    }
    @Put("promotions") async savePromotion(
      @Req() req: Request,
      @Body() body: unknown,
    ) {
      const actor = await service.authorize(req.headers.authorization, true);
      return service.savePromotion(actor, body);
    }
    @Get("payments") async payments(
      @Req() req: Request,
      @Query("status") status?: string,
      @Query("before") before?: string,
      @Query("search") search?: string,
      @Query("beforeId") beforeId?: string,
    ) {
      const actor = await service.authorize(req.headers.authorization, false, false, true);
      return service.paymentList(status, before, actor.role === "cashier", search, beforeId);
    }
    @Get("payment-report") async paymentReport(@Req() req: Request, @Query("from") from: string, @Query("to") to: string) {
      await service.authorize(req.headers.authorization);
      return service.paymentReport(from, to);
    }
    @Get("payments/:id") async paymentDetail(@Req() req: Request, @Param("id") id: string) {
      const actor = await service.authorize(req.headers.authorization, false, false, true);
      return service.paymentDetail(id, actor.role === "cashier");
    }
    @Post("payments/:id/retry") async retry(
      @Req() req: Request,
      @Param("id") id: string,
    ) {
      const actor = await service.authorize(req.headers.authorization, true);
      return service.retryPayment(actor, id);
    }
    @Post("payments/:id/manual-transfer") async manualTransfer(
      @Req() req: Request,
      @Param("id") id: string,
    ) {
      const actor = await service.authorize(req.headers.authorization, true, false, true);
      return service.completeManualPayment(actor, id);
    }
    @Get("audit") async audit(
      @Req() req: Request,
      @Query("before") before?: string,
    ) {
      await service.authorize(req.headers.authorization);
      return service.audit(before);
    }
    @Get("content/:kind") async content(
      @Req() req: Request,
      @Param("kind") kind: string,
    ) {
      await service.authorize(req.headers.authorization);
      return service.content(kind);
    }
    @Put("content/:kind") async saveContent(
      @Req() req: Request,
      @Param("kind") kind: string,
      @Body() body: unknown,
    ) {
      const actor = await service.authorize(req.headers.authorization, true);
      return service.saveContent(actor, kind, body);
    }
    @Get("accounts") async accounts(@Req() req: Request) {
      await service.authorize(req.headers.authorization, false, true);
      return service.accounts();
    }
    @Post("accounts") async addAccount(
      @Req() req: Request,
      @Body() body: unknown,
    ) {
      const actor = await service.authorize(
        req.headers.authorization,
        true,
        true,
      );
      return service.createAccount(actor, body);
    }
    @Put("accounts/:id") async toggleAccount(
      @Req() req: Request,
      @Param("id") id: string,
      @Body() body: unknown,
    ) {
      const actor = await service.authorize(
        req.headers.authorization,
        true,
        true,
      );
      return service.toggleAccount(actor, id, body);
    }
  }
  return AdminController;
}
