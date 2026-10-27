import { useState } from "react";
import { View, Pressable } from "react-native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { formatMoney, type TransactionKind } from "@stech/contracts";
import {
  Screen,
  Heading,
  Label,
  Skeleton,
  ErrorState,
  Button,
  Card,
} from "../../components/ui";
import { TransactionItem } from "../../components/TransactionItem";
import { useDashboard } from "../../hooks/useDashboard";
import { theme } from "../../theme";
import { t } from "../../i18n";
import { api } from "../../services/api";
export default function Transactions() {
  const [filter, setFilter] = useState<TransactionKind | "all">("all");
  const { data, error, isPending, refetch } = useDashboard();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const history = useInfiniteQuery({
    queryKey: ["transactions", data?.member.id],
    queryFn: ({ pageParam }) => api.transactions(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor,
    enabled: !!data && data.features.transactions !== false,
    staleTime: 5000,
    refetchOnWindowFocus: "always",
    refetchInterval: query => (query.state.data?.pages.length ?? 0) <= 1 ? 5000 : false,
  });
  const sessions = useInfiniteQuery({
    queryKey: ["session-history", data?.member.id],
    queryFn: ({ pageParam }) => api.sessionHistory(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: page => page.nextCursor,
    enabled: !!data?.integration && !data.testWallet && (filter === "all" || filter === "usage"),
    staleTime: 5000,
    refetchOnWindowFocus: "always",
    refetchInterval: query => (query.state.data?.pages.length ?? 0) <= 1 ? 5000 : false,
  });
  async function refresh() {
    setIsRefreshing(true);
    try { await Promise.all([refetch(), history.refetch(), ...(data?.integration ? [sessions.refetch()] : [])]); }
    finally { setIsRefreshing(false); }
  }
  const filters = [
    { id: "all", label: t("all") },
    { id: "topup", label: t("topups") },
    { id: "usage", label: t("spending") },
    { id: "bonus", label: t("bonuses") },
    { id: "adjustment", label: "Diğer" },
  ] as const;
  // The dashboard supplies the newest native records every five seconds;
  // older pages use stable source IDs and are never duplicated in this list.
  const seen = new Set<string>();
  const allItems = [
    ...(data?.transactions ?? []),
    ...(history.data?.pages.flatMap(page => page.items) ?? []),
  ].filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  const items = allItems.filter(
    (item) => filter === "all" || item.kind === filter,
  );
  return (
    <Screen
      refreshing={isRefreshing}
      onRefresh={() => {
        void refresh();
      }}
    >
      <View style={{ gap: 8 }}>
        <Heading>{t("transactions")}</Heading>
        <Label muted>
          {data?.testWallet
            ? "Temsili yükleme ve bonusların burada. PanCafe işlem geçmişini içermez."
            : data?.integration?.balanceCredit
              ? "Kasadan ve mobilden yüklemelerin, bonusların ve PanCafe harcamaların."
            : "Hesabındaki tüm hareketler, tek yerde."}
        </Label>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {filters.map((item) => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: filter === item.id }}
            key={item.id}
            onPress={() => setFilter(item.id)}
            style={{
              minHeight: 44,
              paddingHorizontal: 14,
              justifyContent: "center",
              borderRadius: 10,
              backgroundColor:
                filter === item.id
                  ? theme.colors.primary
                  : theme.colors.surface,
            }}
          >
            <Label
              style={{
                fontSize: 12,
                color:
                  filter === item.id
                    ? theme.colors.background
                    : theme.colors.muted,
              }}
            >
              {item.label}
            </Label>
          </Pressable>
        ))}
      </View>
      {isPending || (history.isPending && !!data && !data.transactions.length && data.features.transactions !== false) ? (
        <Skeleton />
      ) : error ? (
        <ErrorState
          message={error.message}
          retry={() => {
            void refetch();
          }}
        />
      ) : data?.features.transactions === false ? (
        <Label muted>PanCafe işlem geçmişi henüz kullanılamıyor.</Label>
      ) : items?.length ? (
        <View>
          {items.map((item) => (
            <TransactionItem key={item.id} item={item} />
          ))}
        </View>
      ) : (
        <Label muted>{history.hasNextPage ? "Bu kayıtlarda seçtiğin türde işlem yok. Daha eski işlemleri yükleyebilirsin." : t("empty")}</Label>
      )}
      {history.error && (
        <ErrorState message={history.error.message} retry={() => {
          void (history.isFetchNextPageError ? history.fetchNextPage() : history.refetch());
        }} />
      )}
      {history.hasNextPage && (
        <Button title="Daha eski işlemleri yükle" secondary busy={history.isFetchingNextPage}
          disabled={history.isFetching} onPress={() => { void history.fetchNextPage(); }} />
      )}
      {!!data?.integration && !data.testWallet && (filter === "all" || filter === "usage") && (
        <View style={{ gap: 14 }}>
          <Heading small>PC oturum ayrıntıları</Heading>
          <Label muted>
            Tamamlanan oturumlarının bilgisayar kullanım ücretleri. Siparişler dahil değildir.
          </Label>
          {sessions.isPending ? <Skeleton /> : sessions.error ? (
            <ErrorState message={sessions.error.message} retry={() => { void sessions.refetch(); }} />
          ) : sessions.data?.pages.some(page => page.items.length) ? (
            sessions.data.pages.flatMap(page => page.items).map(session => (
              <Card key={session.id} style={{ gap: 8 }}>
                <Label>{session.terminal} · {session.durationMinutes} dk</Label>
                <Label muted>
                  {new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(session.startedAt))}
                  {" — "}
                  {new Intl.DateTimeFormat("tr-TR", { timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(session.endedAt))}
                </Label>
                <Label>Kullanım ücreti: {formatMoney(session.usageAmount)}</Label>
              </Card>
            ))
          ) : <Label muted>Henüz tamamlanmış PC oturumu yok.</Label>}
          {sessions.hasNextPage && (
            <Button title="Daha eski oturumları yükle" secondary busy={sessions.isFetchingNextPage}
              disabled={sessions.isFetching} onPress={() => { void sessions.fetchNextPage(); }} />
          )}
        </View>
      )}
    </Screen>
  );
}
