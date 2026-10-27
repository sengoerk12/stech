import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Param,
  Query,
  Req,
  Headers,
  Module,
  BadRequestException,
  UnauthorizedException,
  HttpException,
  Catch,
  ArgumentsHost,
  ExceptionFilter,
  ServiceUnavailableException,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request, Response } from "express";
import helmet from "helmet";
import {
  IsString,
  IsInt,
  Min,
  Max,
  MaxLength,
  MinLength,
  IsBoolean,
  IsIn,
  Matches,
  IsOptional,
  IsEmail,
  validateSync,
} from "class-validator";
import { plainToInstance } from "class-transformer";
import { randomUUID } from "node:crypto";
import { PersistentMockCafeAdapter } from "./cafe/persistent-mock";
import { PanCafeSimulationAdapter } from "./cafe/pancafe-simulation";
import { pageTransactions } from "./cafe/transaction-page";
import type { CafeSystemAdapter } from "./cafe/adapter";
import { MockPaymentProvider } from "./payments/provider";
import { PersistentPaymentService } from "./payments/persistent-service";
import { PersistentAuthService } from "./auth/persistent-service";
import { openDatabase } from "./database/database";
import { readFile } from "node:fs/promises";
import {
  PanCafeSystemAdapter,
  PanCafeBridgeClient,
  type PanCafeBridgeConfig,
} from "./cafe/pancafe";

class LoginDto {
  @IsString() @MaxLength(120) identifier!: string;
  @IsString() @MinLength(1) @MaxLength(256) password!: string;
}
class RegistrationDto {
  @IsString() @Matches(/^[a-zA-Z0-9_.]{3,32}$/) username!: string;
  @IsString() @MinLength(2) @MaxLength(80) @Matches(/\S.*\S/u) name!: string;
  @IsString() @MinLength(8) @MaxLength(128) @Matches(/\S/) password!: string;
  @IsOptional() @IsString() @Matches(/^\+?[0-9 ()-]{10,20}$/) phone?: string;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
}
class RefreshDto {
  @IsString() @MinLength(32) @MaxLength(200) refreshToken!: string;
}
class AmountDto {
  @IsInt() @Min(5000) @Max(1000000) amount!: number;
}
class SimulationDto {
  @IsIn(["succeeded", "failed", "delayed"]) outcome!:
    | "succeeded"
    | "failed"
    | "delayed";
}
class PreferencesDto {
  @IsBoolean() marketing!: boolean;
  @IsBoolean() transactions!: boolean;
  @IsBoolean() lowBalance!: boolean;
}
function parse<T extends object>(type: new () => T, input: unknown): T {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new BadRequestException("Bilgileri kontrol edip tekrar dene.");
  const dto = plainToInstance(type, input);
  if (validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length)
    throw new BadRequestException("Bilgileri kontrol edip tekrar dene.");
  return dto;
}
export function assertDevelopment(env: NodeJS.ProcessEnv) {
  if (
    !["development", "test"].includes(env.ENVIRONMENT ?? "development") ||
    env.NODE_ENV === "production"
  )
    throw new Error(
      "Production/staging disabled: real cafe adapter, payment provider and release security checks must be configured first.",
    );
  if (
    !["mock", "pancafe"].includes(env.CAFE_ADAPTER ?? "mock") ||
    (env.PAYMENT_PROVIDER ?? "mock") !== "mock"
  )
    throw new Error("Requested adapter is not implemented.");
}
@Catch()
class SafeErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const status = error instanceof HttpException ? error.getStatus() : 503;
    const message =
      error instanceof HttpException
        ? error.message
        : "Şu anda işlem gerçekleştirilemiyor. Biraz sonra tekrar dene.";
    res.status(status).json({ statusCode: status, message });
  }
}
export async function createApp(env: NodeJS.ProcessEnv = process.env) {
  assertDevelopment(env);
  const db = await openDatabase({
    url: env.DATABASE_URL,
    directory:
      env.ENVIRONMENT === "test" ? undefined : (env.DATA_DIR ?? ".data/stech"),
  });
  const panCafe = env.CAFE_ADAPTER === "pancafe";
  const bridgeConfig: PanCafeBridgeConfig | null = panCafe
    ? JSON.parse(await readFile(env.PANCAFE_BRIDGE_CONFIG ?? "", "utf8"))
    : null;
  const cafe = bridgeConfig
    ? new PanCafeSystemAdapter(
        db,
        new PanCafeBridgeClient(bridgeConfig),
        bridgeConfig,
      )
    : new PersistentMockCafeAdapter(db, env.DEMO_PASSWORD ?? "StechDemo2026!");
  await cafe.initialize();
  const nativeCredit = panCafe && env.PANCAFE_BALANCE_CREDIT === "true";
  if (nativeCredit && !bridgeConfig?.allowBalanceCredit)
    throw new Error("PanCafe balance credit must also be enabled in the local bridge configuration.");
  const simulation = panCafe && env.PANCAFE_PAYMENT_SIMULATION === "true"
    ? new PanCafeSimulationAdapter(db, cafe, nativeCredit)
    : null;
  if (simulation) await simulation.initialize();
  const paymentCafe = simulation ?? cafe;
  const provider = new MockPaymentProvider();
  const payments = new PersistentPaymentService(db, paymentCafe, provider, nativeCredit ? "pancafe" : "mock");
  const auth = new PersistentAuthService(db, cafe);
  function requirePayments() {
    if (panCafe && !simulation)
      throw new ServiceUnavailableException(
        "PanCafe bakiye yükleme entegrasyonu henüz etkin değil. Şu anda bakiye görüntüleyebilirsin.",
      );
  }
  function token(req: Request) {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer "))
      throw new UnauthorizedException("Devam etmek için giriş yap.");
    return header.slice(7);
  }
  function user(req: Request) {
    return auth.user(token(req));
  }
  @Controller()
  class ApiController {
    @Get("health") health() {
      return {
        status: "ok",
        environment: "development",
        payments: panCafe && !simulation ? "disabled" : "simulation",
        cafe: panCafe ? "pancafe" : "mock",
        balanceCredit: nativeCredit,
      };
    }
    @Post("auth/login") login(@Body() body: unknown) {
      const dto = parse(LoginDto, body);
      return auth.login(dto.identifier, dto.password);
    }
    @Post("auth/register") async register(@Body() body: unknown) {
      const dto = parse(RegistrationDto, body);
      const member = await cafe.register(dto);
      return auth.login(member.username, dto.password);
    }
    @Post("auth/refresh") refresh(@Body() body: unknown) {
      return auth.refresh(parse(RefreshDto, body).refreshToken);
    }
    @Post("auth/logout") async logout(@Req() req: Request) {
      await auth.logout(token(req));
      return { ok: true };
    }
    @Get("me/dashboard") async dashboard(@Req() req: Request) {
      const id = await user(req);
      const [member, wallet, promotions, transactions] = await Promise.all([
        cafe.getUser(id),
        cafe.getBalance(id),
        paymentCafe.getAvailablePromotions(id),
        paymentCafe.getTransactions(id),
      ]);
      return {
        pendingPayments: panCafe && !simulation ? [] : await payments.pending(id),
        member,
        wallet,
        ...(simulation && !nativeCredit ? { testWallet: await simulation.getBalance(id) } : {}),
        promotions,
        transactions,
        features: {
          qr: false,
          membership: false,
          activeSession: false,
          topup: !panCafe || !!simulation,
          transactions: true,
        },
        ...(panCafe
          ? { integration: { ...(cafe as PanCafeSystemAdapter).integration, balanceCredit: nativeCredit } }
          : {}),
      };
    }
    @Get("me/transactions") async transactions(
      @Req() req: Request,
      @Query("cursor") cursor?: string,
    ) {
      const id = await user(req);
      if (cursor !== undefined && (typeof cursor !== "string" || cursor.length > 50))
        throw new BadRequestException("Geçersiz geçmiş sayfası.");
      const adapter: CafeSystemAdapter = paymentCafe;
      return adapter.getTransactionPage
        ? adapter.getTransactionPage(id, cursor)
        : pageTransactions(await adapter.getTransactions(id), cursor);
    }
    @Get("me/session-history") async sessionHistory(@Req() req: Request, @Query("cursor") cursor?: string) {
      const id = await user(req);
      if (cursor !== undefined && (typeof cursor !== "string" || cursor.length > 50))
        throw new BadRequestException("Geçersiz oturum geçmişi sayfası.");
      const adapter: CafeSystemAdapter = cafe;
      return adapter.getSessionHistory ? adapter.getSessionHistory(id, cursor) : { items: [] };
    }
    @Post("payments/quote") async quote(
      @Req() req: Request,
      @Body() body: unknown,
    ) {
      const id = await user(req);
      requirePayments();
      return payments.quote(id, parse(AmountDto, body).amount);
    }
    @Post("payments") async create(
      @Req() req: Request,
      @Body() body: unknown,
      @Headers("idempotency-key") key?: string,
    ) {
      const id = await user(req);
      requirePayments();
      if (!key || !/^[a-zA-Z0-9_-]{16,100}$/.test(key))
        throw new BadRequestException("Geçerli işlem anahtarı gerekli.");
      return payments.create(id, parse(AmountDto, body).amount, key);
    }
    @Get("payments/:id") async payment(
      @Req() req: Request,
      @Param("id") id: string,
    ) {
      const memberId = await user(req);
      requirePayments();
      return payments.get(memberId, id);
    }
    @Post("payments/:id/simulate") async simulate(
      @Req() req: Request,
      @Param("id") id: string,
      @Body() body: unknown,
    ) {
      const memberId = await user(req);
      requirePayments();
      const payment = await payments.get(memberId, id);
      const dto = parse(SimulationDto, body);
      if (dto.outcome === "delayed") paymentCafe.delayTransfer(id, 5000);
      const raw = Buffer.from(
        JSON.stringify({
          eventId: randomUUID(),
          paymentId: id,
          amount: payment.amount,
          currency: "TRY",
          status: dto.outcome === "delayed" ? "succeeded" : dto.outcome,
        }),
      );
      const timestamp = String(Date.now());
      return payments.accept(
        provider.verifyWebhook(raw, provider.sign(raw, timestamp), timestamp),
      );
    }
    @Post("webhooks/payment") async webhook(
      @Req() req: RawBodyRequest<Request>,
      @Headers("x-signature") signature: string,
      @Headers("x-timestamp") timestamp: string,
    ) {
      requirePayments();
      let event;
      try {
        event = provider.verifyWebhook(
          req.rawBody ?? Buffer.alloc(0),
          signature ?? "",
          timestamp ?? "",
        );
      } catch {
        throw new BadRequestException("Geçersiz ödeme bildirimi.");
      }
      await payments.accept(event);
      return { received: true };
    }
    @Get("me/preferences") async getPreferences(@Req() req: Request) {
      const result = await db.query<{
        marketing: boolean;
        transactions: boolean;
        low_balance: boolean;
      }>("SELECT * FROM notification_preferences WHERE user_id=$1", [
        await user(req),
      ]);
      const row = result.rows[0];
      return row
        ? {
            marketing: row.marketing,
            transactions: row.transactions,
            lowBalance: row.low_balance,
          }
        : { marketing: false, transactions: true, lowBalance: true };
    }
    @Put("me/preferences") async setPreferences(
      @Req() req: Request,
      @Body() body: unknown,
    ) {
      const id = await user(req);
      const dto = parse(PreferencesDto, body);
      await db.query(
        "INSERT INTO notification_preferences(user_id,marketing,transactions,low_balance) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET marketing=$2,transactions=$3,low_balance=$4",
        [id, dto.marketing, dto.transactions, dto.lowBalance],
      );
      return dto;
    }
  }
  class RuntimeLifecycle {
    onModuleInit() {
      if (!panCafe || simulation) payments.startWorker();
    }
    async onModuleDestroy() {
      await payments.stopWorker();
      await db.close();
    }
  }
  @Module({ controllers: [ApiController], providers: [RuntimeLifecycle] })
  class AppModule {}
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    logger: ["error", "warn", "log"],
  });
  app.setGlobalPrefix("api/v1");
  app.use(helmet());
  app.enableCors({
    origin: (env.WEB_ORIGIN ?? "http://localhost:8081")
      .split(",")
      .map((origin) => origin.trim()),
    allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
    methods: ["GET", "POST", "PUT"],
  });
  // Bounded in-memory limiter, suitable only for a single-process demo server.
  const buckets = new Map<string, { count: number; expires: number }>();
  app.use((req: Request, res: Response, next: () => void) => {
    const now = Date.now();
    for (const [key, value] of buckets)
      if (value.expires < now) buckets.delete(key);
    const authRoute = req.path.includes("/auth/");
    const key = `${req.ip}:${authRoute ? "auth" : "api"}`;
    const bucket = buckets.get(key) ?? { count: 0, expires: now + 60000 };
    bucket.count++;
    buckets.set(key, bucket);
    if (bucket.count > (authRoute ? 12 : 180)) {
      res.setHeader("Retry-After", "60");
      res.status(429).json({
        statusCode: 429,
        message: "Çok fazla deneme yaptın. Bir dakika sonra tekrar dene.",
      });
      return;
    }
    next();
  });
  app.useGlobalFilters(new SafeErrors());
  app.enableShutdownHooks();
  return app;
}
