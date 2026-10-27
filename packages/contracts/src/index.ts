export type Money = number;
export type PaymentStatus = "pending" | "transferring" | "completed" | "failed";
export type TransactionKind = "topup" | "bonus" | "usage" | "adjustment";
export interface Member {
  id: string;
  username: string;
  name: string;
  phone: string;
  email: string;
  joinedAt: string;
  level: string;
}
export interface Wallet {
  balance: Money;
  updatedAt: string;
  currency: "TRY";
}
export interface Transaction {
  id: string;
  kind: TransactionKind;
  amount: Money;
  title: string;
  createdAt: string;
  balanceAfter: Money;
  description?: string;
}
export interface TransactionPage {
  items: Transaction[];
  nextCursor?: string;
}
export interface CafeSessionHistoryItem {
  id: string;
  terminal: string;
  startedAt: string;
  endedAt: string;
  durationMinutes: number;
  usageAmount: Money;
}
export interface CafeSessionHistoryPage {
  items: CafeSessionHistoryItem[];
  nextCursor?: string;
}
export interface Promotion {
  id: string;
  title: string;
  description: string;
  minimumAmount: Money;
  bonusPercent: number;
  maxBonus: Money;
  startsAt: string;
  endsAt: string;
  terms: string;
  accent: "orange" | "blue";
}
export interface Payment {
  simulation?: boolean;
  creditedToCafe?: boolean;
  id: string;
  amount: Money;
  bonus: Money;
  status: PaymentStatus;
  createdAt: string;
  balanceAfter?: Money;
}
export interface Quote {
  amount: Money;
  bonus: Money;
  total: Money;
  promotionId?: string;
}
export interface NotificationPreferences {
  marketing: boolean;
  transactions: boolean;
  lowBalance: boolean;
}
export interface Dashboard {
  pendingPayments: Payment[];
  member: Member;
  wallet: Wallet;
  testWallet?: Wallet;
  promotions: Promotion[];
  transactions: Transaction[];
  features: {
    qr: boolean;
    membership: boolean;
    activeSession: boolean;
    topup?: boolean;
    transactions?: boolean;
  };
  integration?: { provider: "pancafe"; name: string; balanceCredit?: boolean };
}
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}
export interface ApiError {
  message: string;
  statusCode: number;
}
export const formatMoney = (amount: Money) =>
  new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    minimumFractionDigits: 2,
  }).format(amount / 100);
export interface RegistrationInput {
  username: string;
  name: string;
  password: string;
  phone?: string;
  email?: string;
}
