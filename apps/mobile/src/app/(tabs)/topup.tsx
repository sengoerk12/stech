import { useRef, useState } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { createUuid } from "../../services/uuid";
import { useQuery, useMutation } from "@tanstack/react-query";
import { formatMoney } from "@stech/contracts";
import {
  Screen,
  Label,
  Card,
  Button,
  Field,
  Icon,
  DemoNotice,
  Skeleton,
  ErrorState,
} from "../../components/ui";
import { useDashboard } from "../../hooks/useDashboard";
import { api } from "../../services/api";
import { theme } from "../../theme";

export default function Topup() {
  const dashboard = useDashboard();
  const [amount, setAmount] = useState(0);
  const [custom, setCustom] = useState("");
  const [customMode, setCustomMode] = useState(false);
  const [showMethod, setShowMethod] = useState(false);
  const attempt = useRef({ amount: 0, key: "" });
  const valid =
    Number.isSafeInteger(amount) && amount >= 5000 && amount <= 1000000;
  const quote = useQuery({
    queryKey: ["quote", amount],
    queryFn: () => api.quote(amount),
    enabled: valid && dashboard.data?.features.topup !== false,
    retry: false,
    staleTime: 10000,
  });
  const create = useMutation({
    mutationFn: () => {
      if (attempt.current.amount !== amount)
        attempt.current = { amount, key: createUuid() };
      return api.createPayment(amount, attempt.current.key);
    },
    onSuccess: (p) => {
      attempt.current = { amount: 0, key: "" };
      router.push({ pathname: "/payment/[id]", params: { id: p.id } });
    },
  });
  function updateCustom(value: string) {
    setCustom(value);
    create.reset();
    const normalized = value.replace(",", ".");
    if (!/^\d{0,5}(\.\d{0,2})?$/.test(normalized) || !normalized) {
      setAmount(0);
      return;
    }
    const [whole, fraction = ""] = normalized.split(".");
    setAmount(Number(whole) * 100 + Number(fraction.padEnd(2, "0")));
  }
  return (
    <Screen
      footer={
        <View style={s.checkout}>
          <View style={{ flex: 1, gap: 4 }}>
            <Label muted style={{ fontSize: 12 }}>
              {dashboard.data?.testWallet ? "Temsili yükleme tutarı" : "Ödenecek tutar"}
            </Label>
            <Label style={s.total}>{formatMoney(amount)}</Label>
          </View>
          <View style={{ flex: 1.3 }}>
            <Button
              title={dashboard.data?.testWallet ? "Denemeye geç" : "Ödemeye geç"}
              busy={create.isPending}
              disabled={
                !valid ||
                dashboard.data?.features.topup === false ||
                !quote.data ||
                quote.isFetching ||
                !!quote.error ||
                !dashboard.data ||
                !!dashboard.error
              }
              onPress={() => create.mutate()}
            />
          </View>
        </View>
      }
    >
      <View style={s.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ana sayfaya dön"
          style={s.back}
          onPress={() => router.replace("/")}
        >
          <Icon name="arrow-left" color={theme.colors.text} />
        </Pressable>
        <Label style={s.title}>TL yükle</Label>
        <View style={{ width: 44 }} />
      </View>
      <View style={s.section}>
        {dashboard.data?.integration?.balanceCredit && (
          <Card style={{ gap: 6 }}>
            <Label>Ödeme temsili, bakiye aktarımı gerçek</Label>
            <Label muted>
              Karttan para çekilmez. Başarılı deneme ödemesinde tutar ve bonus
              PanCafe hesabına eklenir ve ana bakiyende görünür.
            </Label>
          </Card>
        )}
        {dashboard.data?.testWallet && (
          <Card style={{ gap: 6 }}>
            <Label>Temsili bakiye yükleme</Label>
            <Label muted>
              Gerçek para çekilmez. Tutar ve bonus yalnızca deneme bakiyene eklenir;
              PanCafe bakiyen değişmez.
            </Label>
          </Card>
        )}
        {dashboard.data?.features.topup === false && (
          <Card>
            <Label>Bu hesabın bakiyesi PanCafe’den okunuyor.</Label>
            <Label muted>Online bakiye yükleme henüz kullanılamıyor.</Label>
          </Card>
        )}
        <Label style={s.sectionTitle}>Yükleme yapılacak hesap</Label>
        {dashboard.isPending ? (
          <Skeleton />
        ) : dashboard.error ? (
          <ErrorState
            message={dashboard.error.message}
            retry={() => {
              void dashboard.refetch();
            }}
          />
        ) : (
          dashboard.data && (
            <LinearGradient
              colors={[
                theme.colors.blueTint,
                theme.colors.elevated,
                theme.colors.orangeTint,
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={s.account}
            >
              <View style={s.accountIcon}>
                <Icon name="monitor" color={theme.colors.accent} size={29} />
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <Label style={{ fontSize: 16 }}>
                  {dashboard.data.testWallet ? "S TECH deneme bakiyem" : "S TECH hesabım"}
                </Label>
                <Label style={s.balance}>
                  {formatMoney((dashboard.data.testWallet ?? dashboard.data.wallet).balance)}
                </Label>
                <Label muted style={{ fontSize: 12 }}>
                  @{dashboard.data.member.username}
                </Label>
              </View>
            </LinearGradient>
          )
        )}
      </View>
      <View style={s.section}>
        <Label style={s.sectionTitle}>Ödeme aracı</Label>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showMethod }}
          onPress={() => setShowMethod(!showMethod)}
          style={s.method}
        >
          <Icon name="credit-card" color={theme.colors.accent} size={24} />
          <View style={{ flex: 1, gap: 5 }}>
            <Label style={{ fontFamily: theme.font.bold, fontSize: 15 }}>
              Banka / kredi kartı
            </Label>
            <Label muted style={{ fontSize: 12 }}>
              {dashboard.data?.features.topup === false
                ? "Online bakiye yükleme henüz kullanılamıyor"
                : "Şu anda deneme ödemesi kullanılabilir"}
            </Label>
          </View>
          <Icon name={showMethod ? "chevron-up" : "chevron-down"} size={20} />
        </Pressable>
        {showMethod && (
          <Card style={{ gap: 8 }}>
            <Label>Deneme ödeme yöntemi</Label>
            <Label muted>
              {dashboard.data?.features.topup === false
                ? "PanCafe hesabına online yükleme açıldığında buradan devam edebilirsin."
                : "Kart bilgisi girilmez ve gerçek para çekilmez. Sonraki ekranda ödeme sonucunu deneyebilirsin."}
            </Label>
          </Card>
        )}
      </View>
      <View style={s.section}>
        <View style={s.header}>
          <Label style={s.sectionTitle}>Tutar</Label>
          <Label muted style={{ fontSize: 11 }}>
            TL
          </Label>
        </View>
        <View style={s.grid}>
          {[5000, 10000, 20000, 40000, 100000, 200000].map((value) => {
            const selected = !customMode && amount === value;
            const bonusPromotion = dashboard.data?.promotions.find(
              (promotion) =>
                value >= promotion.minimumAmount &&
                promotion.bonusPercent > 0 &&
                Date.now() >= Date.parse(promotion.startsAt) &&
                Date.now() < Date.parse(promotion.endsAt),
            );
            return (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityLabel={`${value / 100} TL${bonusPromotion ? `, yüzde ${bonusPromotion.bonusPercent} bonus` : ""}`}
                accessibilityState={{
                  checked: selected,
                  disabled:
                    create.isPending ||
                    dashboard.data?.features.topup === false,
                }}
                disabled={
                  create.isPending || dashboard.data?.features.topup === false
                }
                onPress={() => {
                  setCustomMode(false);
                  setAmount(value);
                  create.reset();
                }}
                style={[s.amount, selected && s.selected]}
              >
                {bonusPromotion && (
                  <View style={s.gift}>
                    <Icon
                      name="gift"
                      size={15}
                      color={theme.colors.background}
                    />
                  </View>
                )}
                <Label
                  style={{
                    fontFamily: theme.font.bold,
                    fontSize: 14,
                    color: selected ? theme.colors.primary : theme.colors.text,
                  }}
                >
                  {(value / 100).toLocaleString("tr-TR")} TL
                </Label>
                {bonusPromotion && (
                  <Label
                    style={{
                      fontSize: 10,
                      lineHeight: 16,
                      color: theme.colors.primary,
                    }}
                  >
                    %{bonusPromotion.bonusPercent} bonus
                  </Label>
                )}
              </Pressable>
            );
          })}
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={
            create.isPending || dashboard.data?.features.topup === false
          }
          onPress={() => {
            setCustomMode(!customMode);
            setAmount(0);
            setCustom("");
            create.reset();
          }}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <Label style={{ color: theme.colors.accent }}>
            {customMode ? "Hızlı tutarlara dön" : "+ Farklı tutar"}
          </Label>
        </Pressable>
        {customMode && (
          <Field
            label="Yüklenecek tutar (TL)"
            keyboardType="decimal-pad"
            value={custom}
            onChangeText={updateCustom}
            editable={!create.isPending}
            placeholder="50 – 10.000 TL"
          />
        )}
        {customMode && !!custom && !valid && (
          <Label style={{ color: theme.colors.error, fontSize: 12 }}>
            50 TL ile 10.000 TL arasında bir tutar gir.
          </Label>
        )}
        {valid && (
          <Card style={{ gap: 10 }}>
            <View style={s.summary}>
              <Label muted>Bonus</Label>
              <Label style={{ color: theme.colors.primary }}>
                {quote.isFetching
                  ? "Hesaplanıyor…"
                  : quote.data
                    ? "+" + formatMoney(quote.data.bonus)
                    : "—"}
              </Label>
            </View>
            <View style={s.summary}>
              <Label style={{ flex: 1 }}>Hesabına geçecek</Label>
              <Label style={{ fontFamily: theme.font.bold }}>
                {!quote.isFetching && quote.data
                  ? formatMoney(quote.data.total)
                  : "—"}
              </Label>
            </View>
          </Card>
        )}
        {(quote.error || create.error) && (
          <Label style={{ color: theme.colors.error }}>
            {(quote.error ?? create.error)?.message}
          </Label>
        )}
      </View>
      <DemoNotice />
    </Screen>
  );
}
const s = StyleSheet.create({
  gift: {
    position: "absolute",
    right: -5,
    top: -9,
    width: 27,
    height: 27,
    borderRadius: 14,
    backgroundColor: theme.colors.primary,
    borderWidth: 2,
    borderColor: theme.colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  back: { width: 44, height: 44, justifyContent: "center" },
  title: { fontFamily: theme.font.bold, fontSize: 20, lineHeight: 28 },
  section: { gap: 16 },
  sectionTitle: { fontFamily: theme.font.bold, fontSize: 17, lineHeight: 25 },
  account: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 22,
    minHeight: 140,
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
  },
  accountIcon: {
    width: 48,
    height: 56,
    justifyContent: "center",
    alignItems: "center",
  },
  balance: { fontFamily: theme.font.bold, fontSize: 27, lineHeight: 36 },
  method: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 16,
    padding: 18,
    minHeight: 94,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: theme.colors.surface,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  amount: {
    width: "30%",
    flexGrow: 1,
    minHeight: 62,
    paddingHorizontal: 6,
    paddingVertical: 12,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    backgroundColor: theme.colors.surface,
  },
  selected: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.orangeTint,
  },
  summary: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  checkout: { flexDirection: "row", alignItems: "center", gap: 12 },
  total: { fontFamily: theme.font.bold, fontSize: 20, lineHeight: 28 },
});
