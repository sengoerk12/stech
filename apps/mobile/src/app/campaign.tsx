import { router, useLocalSearchParams } from "expo-router";
import {
  Screen,
  Heading,
  Label,
  Card,
  Button,
  Skeleton,
  ErrorState,
} from "../components/ui";
import { PromotionCard } from "../components/PromotionCard";
import { useDashboard } from "../hooks/useDashboard";
export default function Campaign() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isPending, error } = useDashboard();
  const p = data?.promotions.find((item) => item.id === id);
  return (
    <Screen>
      <Button title="Geri dön" secondary onPress={() => router.back()} />
      {isPending ? (
        <Skeleton />
      ) : error ? (
        <ErrorState message={error.message} />
      ) : p ? (
        <>
          <PromotionCard promotion={p} />
          <Heading>Kampanya koşulları</Heading>
          <Card style={{ gap: 16 }}>
            <Label>{p.terms}</Label>
            <Label muted>
              Geçerlilik: {new Date(p.startsAt).toLocaleDateString("tr-TR")} –{" "}
              {new Date(p.endsAt).toLocaleDateString("tr-TR")}
            </Label>
          </Card>
          <Button
            title="Bonusla bakiye yükle"
            onPress={() => router.push("/topup")}
          />
        </>
      ) : (
        <Label>Bu kampanya sona ermiş veya artık kullanılamıyor.</Label>
      )}
    </Screen>
  );
}
