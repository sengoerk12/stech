import { router } from "expo-router";
import { Screen, Heading, Label, Card, Button } from "../components/ui";
export default function Legal() {
  return (
    <Screen>
      <Button title="Geri dön" secondary onPress={() => router.back()} />
      <Heading>Gizlilik ve kullanım</Heading>
      <Card style={{ gap: 16 }}>
        <Label>
          Bu sürüm bir geliştirme ortamıdır. Örnek hesap bilgileri kullanılır;
          gerçek ödeme alınmaz.
        </Label>
        <Label muted>
          Yayın öncesinde işletmenin veri sorumlusu bilgilerini, saklama
          sürelerini, iletişim kanallarını ve ödeme koşullarını içeren onaylı
          gizlilik politikası ile kullanım koşulları eklenecektir.
        </Label>
      </Card>
    </Screen>
  );
}
