import { router } from "expo-router";
import { Screen, Heading, Label, Button } from "../components/ui";
export default function NotFound() {
  return (
    <Screen>
      <Heading>Bu sayfa bulunamadı.</Heading>
      <Label>Bağlantı artık geçerli olmayabilir.</Label>
      <Button title="Ana sayfaya dön" onPress={() => router.replace("/")} />
    </Screen>
  );
}
