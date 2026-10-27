import { View, Image, Pressable, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { formatMoney } from "@stech/contracts";
import {
  Screen,
  Label,
  Badge,
  Card,
  Button,
  Section,
  Icon,
  Skeleton,
  ErrorState,
  DemoNotice,
} from "../../components/ui";
import { TransactionItem } from "../../components/TransactionItem";
import { PromotionCard } from "../../components/PromotionCard";
import { useDashboard } from "../../hooks/useDashboard";
import { theme as th } from "../../theme";
import { t } from "../../i18n";
export default function Home() {
  const { data, error, isPending, isRefreshing, refresh, refetch } = useDashboard();
  return (
    <Screen
      refreshing={isRefreshing}
      onRefresh={() => {
        void refresh();
      }}
    >
      <View style={styles.header}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 11 }}>
          <Image
            source={require("../../../assets/brand-logo.png")}
            style={{
              width: 48,
              height: 54,
              resizeMode: "contain",
              borderRadius: 24,
            }}
          />
          <View>
            <Label
              style={{
                fontFamily: th.font.display,
                fontSize: 22,
                lineHeight: 28,
                letterSpacing: 2,
              }}
            >
              S TECH
            </Label>
            <Label muted style={{ fontSize: 10, letterSpacing: 1.4 }}>
              E-SPOR & GAMING
            </Label>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Bildirim tercihleri"
          onPress={() => router.push("/notifications")}
          style={styles.iconButton}
        >
          <Icon name="bell" size={20} />
        </Pressable>
      </View>
      {isPending ? (
        <Skeleton />
      ) : error ? (
        <ErrorState
          message={error.message}
          retry={() => {
            void refetch();
          }}
        />
      ) : (
        data && (
          <>
            <View style={{ gap: 5 }}>
              <Label muted>{t("welcome")}</Label>
              <View style={{ gap: 10 }}>
                <Label
                  style={{
                    fontFamily: th.font.bold,
                    fontSize: 26,
                    lineHeight: 36,
                  }}
                >
                  {data.member.name}
                </Label>
                {!!data.member.level && <Badge blue>{data.member.level}</Badge>}
              </View>
            </View>
            <LinearGradient
              colors={[
                th.colors.blueTint,
                th.colors.surface,
                th.colors.orangeTint,
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.wallet}
            >
              <View style={styles.walletLine} />
              <View style={styles.decor}>
                <Icon name="zap" color="#334154" size={132} />
              </View>
              <View style={styles.header}>
                <Label muted style={{ fontSize: 12, letterSpacing: 1 }}>
                  {t("balance")}
                </Label>
                <Icon name="credit-card" color={th.colors.primary} size={20} />
              </View>
              <Label style={styles.amount}>
                {formatMoney(data.wallet.balance)}
              </Label>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 20,
                }}
              >
                <View
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: 3,
                    backgroundColor: th.colors.success,
                  }}
                />
                <Label muted style={{ fontSize: 12, flex: 1 }}>
                  {data.integration
                    ? `${data.integration.name} · PanCafe hesabın`
                    : "Oyun için hazır bakiyen"}
                </Label>
              </View>
            </LinearGradient>
            {data.testWallet && (
              <Card style={{ gap: 8, borderColor: th.colors.primary }}>
                <Label style={{ color: th.colors.primary }}>Temsili yükleme bakiyen</Label>
                <Label style={{ fontSize: 28, fontFamily: th.font.bold }}>
                  {formatMoney(data.testWallet.balance)}
                </Label>
                <Label muted>
                  Yalnızca deneme içindir. PanCafe bakiyene eklenmez ve bilgisayarda kullanılamaz.
                </Label>
              </Card>
            )}
            <View style={styles.actions}>
              {(
                [
                  {
                    title: "Yükle",
                    icon: "plus-circle",
                    path: "/topup",
                    primary: true,
                  },
                  {
                    title: "İşlemler",
                    icon: "clock",
                    path: "/transactions",
                    primary: false,
                  },
                  {
                    title: "Fırsatlar",
                    icon: "gift",
                    path: "/campaigns",
                    primary: false,
                  },
                ] as const
              ).map((action) => (
                <Pressable
                  key={action.path}
                  accessibilityRole="button"
                  onPress={() => router.push(action.path)}
                  style={({ pressed }) => [
                    styles.action,
                    action.primary && {
                      backgroundColor: th.colors.primary,
                      borderColor: th.colors.primary,
                    },
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Icon
                    name={action.icon}
                    size={23}
                    color={
                      action.primary ? th.colors.background : th.colors.accent
                    }
                  />
                  <Label
                    style={{
                      fontSize: 12,
                      lineHeight: 18,
                      fontFamily: th.font.bold,
                      color: action.primary
                        ? th.colors.background
                        : th.colors.text,
                    }}
                  >
                    {action.title}
                  </Label>
                </Pressable>
              ))}
            </View>
            {data.pendingPayments?.map((payment) => (
              <Card
                key={payment.id}
                style={{ gap: 12, borderColor: th.colors.primary }}
              >
                <Label
                  style={{ color: th.colors.primary, fontFamily: th.font.bold }}
                >
                  {payment.status === "transferring"
                    ? "Ödemen alındı, bakiyen aktarılıyor"
                    : "Devam eden yüklemen var"}
                </Label>
                <Label muted>
                  {formatMoney(payment.amount)}
                  {payment.status === "transferring"
                    ? " · Tekrar ödeme yapmana gerek yok."
                    : " · İşlemin durumunu kontrol edebilirsin."}
                </Label>
                <Button
                  title="İşlemi görüntüle"
                  secondary
                  onPress={() =>
                    router.push({
                      pathname: "/payment/[id]",
                      params: { id: payment.id },
                    })
                  }
                />
              </Card>
            ))}
            <View style={{ gap: 10 }}>
              <Section
                title={data.testWallet ? "Deneme kampanyaları" : "Kampanyalar"}
                action={t("seeAll")}
                onPress={() => router.push("/campaigns")}
              />
              {data.promotions[0] ? (
                <PromotionCard promotion={data.promotions[0]} compact />
              ) : (
                <Label muted>Yeni fırsatlar burada seni bekleyecek.</Label>
              )}
            </View>
            <View>
              <Section
                title={data.testWallet ? "Son deneme işlemleri" : t("recent")}
                action={t("seeAll")}
                onPress={() => router.push("/transactions")}
              />
              {data.features.transactions === false && (
                <Card>
                  <Label muted>
                    PanCafe işlem geçmişi henüz kullanılamıyor.
                  </Label>
                </Card>
              )}
              {data.features.transactions !== false &&
                data.transactions.length === 0 && (
                  <Card
                    style={{
                      flexDirection: "row",
                      gap: 14,
                      alignItems: "center",
                    }}
                  >
                    <Icon name="clock" color={th.colors.accent} />
                    <View style={{ flex: 1, gap: 4 }}>
                      <Label>Henüz işlemin yok</Label>
                      <Label muted style={{ fontSize: 12 }}>
                        İlk bakiye yüklemen burada görünecek.
                      </Label>
                    </View>
                  </Card>
                )}
              {data.transactions.slice(0, 3).map((item) => (
                <TransactionItem key={item.id} item={item} />
              ))}
            </View>
            <View style={{ alignItems: "center", gap: 8 }}>
              <Label
                muted
                style={{
                  fontFamily: th.font.display,
                  fontSize: 13,
                  letterSpacing: 2,
                }}
              >
                {t("tagline")}
              </Label>
              <DemoNotice />
            </View>
          </>
        )
      )}
    </Screen>
  );
}
const styles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: -12 },
  action: {
    flex: 1,
    minWidth: 78,
    minHeight: 100,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: th.colors.border,
    backgroundColor: th.colors.surface,
    padding: 12,
    gap: 14,
    justifyContent: "space-between",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderColor: th.colors.border,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  wallet: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#384254",
    padding: 24,
    overflow: "hidden",
  },
  walletLine: {
    position: "absolute",
    top: 0,
    left: 24,
    right: 24,
    height: 2,
    backgroundColor: th.colors.primary,
    opacity: 0.7,
  },
  amount: {
    fontSize: 44,
    lineHeight: 64,
    marginTop: 8,
    marginBottom: 2,
    fontFamily: th.font.bold,
    letterSpacing: -1.5,
    fontVariant: ["tabular-nums"],
  },
  decor: {
    position: "absolute",
    right: -10,
    top: 20,
    transform: [{ rotate: "-12deg" }],
    opacity: 0.35,
  },
});
