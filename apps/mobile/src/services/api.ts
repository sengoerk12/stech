import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import type {
  AuthTokens,
  RegistrationInput,
  Dashboard,
  TransactionPage,
  CafeSessionHistoryPage,
  Payment,
  Quote,
  NotificationPreferences,
} from "@stech/contracts";
const baseUrl =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  (Platform.OS === "web" && typeof window !== "undefined"
    ? `http://${window.location.hostname}:3001/api/v1`
    : Platform.OS === "android"
      ? "http://10.0.2.2:3001/api/v1"
      : "http://localhost:3001/api/v1");
let tokens: AuthTokens | null = null;
let remember = false;
let refreshing: Promise<void> | null = null;
let onExpired: (() => void) | undefined;
export class ApiFailure extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function save(next: AuthTokens | null) {
  tokens = next;
  if (Platform.OS !== "web") {
    if (next && remember)
      await SecureStore.setItemAsync("stech.session", JSON.stringify(next));
    else await SecureStore.deleteItemAsync("stech.session");
  }
}
async function request<T>(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response: Response;
  try {
    response = await fetch(baseUrl + path, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(tokens ? { Authorization: `Bearer ${tokens.accessToken}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiFailure(
      "Bağlantı kurulamadı. İnternetini kontrol edip tekrar dene.",
      0,
    );
  } finally {
    clearTimeout(timeout);
  }
  if (
    response.status === 401 &&
    tokens &&
    retry &&
    !path.startsWith("/auth/")
  ) {
    if (!refreshing)
      refreshing = request<AuthTokens>(
        "/auth/refresh",
        {
          method: "POST",
          body: JSON.stringify({ refreshToken: tokens.refreshToken }),
        },
        false,
      )
        .then(save)
        .catch(async (error) => {
          await save(null);
          onExpired?.();
          throw error;
        })
        .finally(() => {
          refreshing = null;
        });
    await refreshing;
    return request<T>(path, options, false);
  }
  const data = await response.json();
  if (!response.ok)
    throw new ApiFailure(
      data.message ?? "İşlem tamamlanamadı.",
      response.status,
    );
  return data as T;
}
const post = <T>(
  path: string,
  body: unknown,
  headers?: Record<string, string>,
) => request<T>(path, { method: "POST", body: JSON.stringify(body), headers });
export const api = {
  health: () =>
    request<{ cafe: "mock" | "pancafe"; payments: string }>("/health"),
  onExpired(callback: () => void) {
    onExpired = callback;
  },
  async restore() {
    if (Platform.OS === "web") return false;
    const value = await SecureStore.getItemAsync("stech.session");
    if (!value) return false;
    try {
      tokens = JSON.parse(value);
      remember = true;
      return true;
    } catch {
      await save(null);
      return false;
    }
  },
  async login(identifier: string, password: string, persist: boolean) {
    const result = await post<AuthTokens>("/auth/login", {
      identifier,
      password,
    });
    remember = persist;
    await save(result);
  },
  async logout() {
    try {
      await post("/auth/logout", {});
    } finally {
      await save(null);
    }
  },
  async register(input: RegistrationInput) {
    const result = await post<AuthTokens>("/auth/register", input);
    remember = false;
    await save(result);
  },
  dashboard: () => request<Dashboard>("/me/dashboard"),
  transactions: (cursor?: string) => request<TransactionPage>(`/me/transactions${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
  sessionHistory: (cursor?: string) => request<CafeSessionHistoryPage>(`/me/session-history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
  quote: (amount: number) => post<Quote>("/payments/quote", { amount }),
  createPayment: (amount: number, key: string) =>
    post<Payment>("/payments", { amount }, { "Idempotency-Key": key }),
  payment: (id: string) =>
    request<Payment>(`/payments/${encodeURIComponent(id)}`),
  simulate: (id: string, outcome: "succeeded" | "failed" | "delayed") =>
    post<Payment>(`/payments/${encodeURIComponent(id)}/simulate`, { outcome }),
  preferences: () => request<NotificationPreferences>("/me/preferences"),
  updatePreferences: (value: NotificationPreferences) =>
    request<NotificationPreferences>("/me/preferences", {
      method: "PUT",
      body: JSON.stringify(value),
    }),
};
