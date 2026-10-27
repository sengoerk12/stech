import { router } from "expo-router";
import { Screen, Heading, Label, Card, Button } from "../components/ui";
export default function Support() {
  return (
    <Screen>
      <Button title="Geri dön" secondary onPress={() => router.back()} />
      <Heading>Hesabın için buradayız.</Heading>
      <Card style={{ gap: 16 }}>
        <Label>
          Şifreni unuttuysan veya üyelik bilgilerini güncellemek istiyorsan
          şubendeki S TECH yetkilisinden yardım alabilirsin.
        </Label>
        <Label muted>
          Mobil şifre yenileme, mevcut üyelik sisteminin doğrulama bağlantısı
          tamamlandığında açılacak.
        </Label>
      </Card>
    </Screen>
  );
}
