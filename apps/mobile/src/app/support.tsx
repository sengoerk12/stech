import { router } from "expo-router";
import { Screen, Heading, Label, Card, Button } from "../components/ui";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
export default function Support() {
  const settings=useQuery({queryKey:["public-settings"],queryFn:api.publicSettings,staleTime:60000});
  return (
    <Screen>
      <Button title="Geri dön" secondary onPress={() => router.back()} />
      <Heading>Hesabın için buradayız.</Heading>
      <Card style={{ gap: 16 }}>
        <Label>
          {settings.data?.supportText ?? "Şifreni unuttuysan veya üyelik bilgilerini güncellemek istiyorsan şubendeki S TECH yetkilisinden yardım alabilirsin."}
        </Label>
        <Label muted>
          Mobil şifre yenileme, mevcut üyelik sisteminin doğrulama bağlantısı
          tamamlandığında açılacak.
        </Label>
      </Card>
    </Screen>
  );
}
