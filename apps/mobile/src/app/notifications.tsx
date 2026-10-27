import { View, Switch } from "react-native";
import { router } from "expo-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { NotificationPreferences } from "@stech/contracts";
import {
  Screen,
  Heading,
  Label,
  Card,
  Button,
  Skeleton,
  ErrorState,
} from "../components/ui";
import { api } from "../services/api";
import { theme } from "../theme";
export default function Notifications() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["preferences"],
    queryFn: api.preferences,
  });
  const mutation = useMutation({
    mutationFn: api.updatePreferences,
    onSuccess: (data) => client.setQueryData(["preferences"], data),
  });
  const rows: {
    key: keyof NotificationPreferences;
    title: string;
    description: string;
  }[] = [
    {
      key: "marketing",
      title: "Kampanyalar ve fırsatlar",
      description: "Bonuslar, turnuvalar ve özel teklifler.",
    },
    {
      key: "transactions",
      title: "İşlem bildirimleri",
      description: "Ödeme ve bakiye yükleme sonuçları.",
    },
    {
      key: "lowBalance",
      title: "Düşük bakiye uyarısı",
      description: "Oyunun yarıda kalmadan haberdar ol.",
    },
  ];
  return (
    <Screen>
      <Button title="Geri dön" secondary onPress={() => router.back()} />
      <Heading>Bildirim tercihleri</Heading>
      {query.isPending ? (
        <Skeleton />
      ) : query.error ? (
        <ErrorState message={query.error.message} />
      ) : (
        query.data && (
          <Card style={{ gap: 24 }}>
            {rows.map((row) => (
              <View
                key={row.key}
                style={{ flexDirection: "row", alignItems: "center", gap: 16 }}
              >
                <View style={{ flex: 1 }}>
                  <Label>{row.title}</Label>
                  <Label muted style={{ fontSize: 12 }}>
                    {row.description}
                  </Label>
                </View>
                <Switch
                  accessibilityLabel={row.title}
                  disabled={mutation.isPending}
                  value={query.data[row.key]}
                  trackColor={{ true: theme.colors.primary }}
                  onValueChange={(value) =>
                    mutation.mutate({ ...query.data!, [row.key]: value })
                  }
                />
              </View>
            ))}
          </Card>
        )
      )}
      {mutation.error && (
        <Label style={{ color: theme.colors.error }}>
          {mutation.error.message}
        </Label>
      )}
      <Label muted>
        Tercihlerin hesabına kaydedilir. Cihaza bildirim gönderimi henüz etkin
        değil.
      </Label>
    </Screen>
  );
}
