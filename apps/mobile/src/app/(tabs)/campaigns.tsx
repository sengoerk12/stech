import { View } from "react-native";
import {
  Screen,
  Heading,
  Label,
  Skeleton,
  ErrorState,
} from "../../components/ui";
import { PromotionCard } from "../../components/PromotionCard";
import { useDashboard } from "../../hooks/useDashboard";
export default function Campaigns() {
  const { data, error, isPending, refetch } = useDashboard();
  return (
    <Screen>
      <View style={{ gap: 8 }}>
        <Heading>Oyunun avantajlı hali.</Heading>
        <Label muted>
          {data?.testWallet
            ? "Deneme kampanyaları yalnızca temsili bakiyene uygulanır."
            : "S TECH üyelerine özel bonuslar ve fırsatlar."}
        </Label>
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
      ) : data?.promotions.length ? (
        data.promotions.map((p) => <PromotionCard key={p.id} promotion={p} />)
      ) : (
        <Label muted>
          Şu anda aktif kampanya yok. Yeni fırsatlar burada görünecek.
        </Label>
      )}
    </Screen>
  );
}
