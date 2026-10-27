import { View } from "react-native";
import { useEffect } from "react";
import { router, useLocalSearchParams, Redirect } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatMoney } from "@stech/contracts";
import {
  Screen,
  Heading,
  Label,
  Card,
  Button,
  Icon,
  Badge,
  ErrorState,
  Skeleton,
  DemoNotice,
} from "../../components/ui";
import { api } from "../../services/api";
import { useAuth } from "../../features/auth/context";
import { theme } from "../../theme";
import { t } from "../../i18n";
export default function PaymentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { signedIn, ready } = useAuth();
  const client = useQueryClient();
  const payment = useQuery({
    queryKey: ["payment", id],
    queryFn: () => api.payment(id),
    enabled: signedIn && !!id,
    refetchInterval: (query) =>
      ["pending", "transferring"].includes(query.state.data?.status ?? "")
        ? 2500
        : false,
  });
  const simulate = useMutation({
    mutationFn: (outcome: "succeeded" | "failed" | "delayed") =>
      api.simulate(id, outcome),
    onSuccess: (data) => {
      client.setQueryData(["payment", id], data);
      void client.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
  useEffect(() => {
    if (
      payment.data?.status === "completed" ||
      payment.data?.status === "failed"
    )
      void client.invalidateQueries({ queryKey: ["dashboard"] });
  }, [payment.data?.status, client]);
  if (ready && !signedIn) return <Redirect href="/login" />;
  const p = payment.data;
  return (
    <Screen>
      {payment.isPending ? (
        <Skeleton />
      ) : payment.error ? (
        <ErrorState
          message={payment.error.message}
          retry={() => {
            void payment.refetch();
          }}
        />
      ) : (
        p && (
          <>
            <Badge>
              {p.status === "completed"
                ? (p.simulation && !p.creditedToCafe ? "DENEME BAKİYENE EKLENDİ" : "HESABINA AKTARILDI")
                : "BAKİYE YÜKLEME"}
            </Badge>
            <View style={{ alignItems: "center", gap: 20, marginVertical: 24 }}>
              <View
                style={{
                  width: 88,
                  height: 88,
                  borderRadius: 28,
                  backgroundColor:
                    p.status === "failed"
                      ? theme.colors.surface
                      : theme.colors.orangeTint,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon
                  name={
                    p.status === "completed"
                      ? "check"
                      : p.status === "failed"
                        ? "x"
                        : "shield"
                  }
                  color={
                    p.status === "completed"
                      ? theme.colors.success
                      : p.status === "failed"
                        ? theme.colors.error
                        : theme.colors.primary
                  }
                  size={40}
                />
              </View>
              <Heading>
                {p.status === "completed"
                  ? (p.simulation ? "Temsili yükleme başarılı!" : t("paymentSuccess"))
                  : p.status === "failed"
                    ? t("failed")
                    : p.status === "transferring"
                      ? "Bakiyen aktarılıyor"
                      : t("payment")}
              </Heading>
              <Label muted style={{ textAlign: "center" }}>
                {p.status === "completed"
                  ? (p.simulation
                    ? (p.creditedToCafe ? "Ödeme temsiliydi; tutar ve bonus PanCafe hesabına eklendi. Gerçek para çekilmedi." : "Gerçek para çekilmedi. Tutar ve bonus deneme bakiyene eklendi.")
                    : t("paymentSuccessBody"))
                  : p.status === "failed"
                    ? t("failedBody")
                    : p.status === "transferring"
                      ? "Ödemen alındı. Tekrar ödeme yapmana gerek yok. Hesabına aktarılmasını bekliyoruz."
                      : "Tutarını kontrol et ve yüklemeni tamamla."}
              </Label>
            </View>
            <Card style={{ gap: 16 }}>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                }}
              >
                <Label muted>{t("yourTopup")}</Label>
                <Label>{formatMoney(p.amount)}</Label>
              </View>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                }}
              >
                <Label muted>Bonus</Label>
                <Label style={{ color: theme.colors.primary }}>
                  +{formatMoney(p.bonus)}
                </Label>
              </View>
              {p.status === "completed" && p.balanceAfter !== undefined && (
                <View
                  style={{
                    paddingTop: 16,
                    borderTopWidth: 1,
                    borderTopColor: theme.colors.border,
                  }}
                >
                  <Label muted>{p.simulation && !p.creditedToCafe ? "İşlem sonrası deneme bakiyen" : "İşlem sonrası bakiyen"}</Label>
                  <Label
                    style={{
                      fontSize: 34,
                      lineHeight: 48,
                      fontFamily: theme.font.bold,
                    }}
                  >
                    {formatMoney(p.balanceAfter)}
                  </Label>
                </View>
              )}
              <Label muted style={{ fontSize: 10 }}>
                İşlem no: {p.id}
              </Label>
            </Card>
            {p.status === "pending" && (
              <Card style={{ gap: 14 }}>
                <Label style={{ color: theme.colors.primary }}>
                  Deneme ödemesi
                </Label>
                <Label muted>
                  Bu ortamda kart bilgisi alınmaz ve para çekilmez. Aşağıdaki
                  seçenekler banka yanıtını simüle eder.
                </Label>
                <Button
                  title="Başarılı ödemeyi dene"
                  busy={simulate.isPending}
                  onPress={() => simulate.mutate("succeeded")}
                />
                <Button
                  title="Reddedilen ödemeyi dene"
                  secondary
                  disabled={simulate.isPending}
                  onPress={() => simulate.mutate("failed")}
                />
                <Button
                  title="Gecikmeli aktarımı dene"
                  secondary
                  disabled={simulate.isPending}
                  onPress={() => simulate.mutate("delayed")}
                />
              </Card>
            )}
            {simulate.error && (
              <ErrorState
                message={simulate.error.message}
                retry={() => {
                  void payment.refetch();
                }}
              />
            )}
            <Button
              title={t("homeReturn")}
              secondary
              onPress={() => router.replace("/")}
            />
            <DemoNotice />
          </>
        )
      )}
    </Screen>
  );
}
