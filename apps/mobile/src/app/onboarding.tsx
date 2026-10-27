import { useState } from "react";
import { View, Image, Pressable } from "react-native";
import { router } from "expo-router";
import {
  Screen,
  Heading,
  Label,
  Button,
  Icon,
  DemoNotice,
} from "../components/ui";
import { completeOnboarding } from "../features/auth/onboarding";
import { theme } from "../theme";
const slides = [
  {
    icon: "credit-card" as const,
    overline: "HESABIN CEBİNDE",
    title: "Kasada bekleme.\nOyuna odaklan.",
    description:
      "Mevcut S TECH hesabına her yerden bakiye yükle. Oyun için daha fazla zamanın kalsın.",
  },
  {
    icon: "gift" as const,
    overline: "DAHA FAZLA AVANTAJ",
    title: "Bonusları yakala.\nOyunu uzat.",
    description:
      "Üyelere özel kampanyaları keşfet. Yüklemene uygun bonus, hesabına otomatik eklensin.",
  },
  {
    icon: "activity" as const,
    overline: "KONTROL SENDE",
    title: "Her hareketin,\ntek bir yerde.",
    description:
      "Bakiyeni ve işlem geçmişini takip et. Mevcut üyeliğinle hemen giriş yap.",
  },
];
export default function Onboarding() {
  const [index, setIndex] = useState(0);
  const slide = slides[index];
  async function finish() {
    await completeOnboarding();
    router.replace("/login");
  }
  return (
    <Screen>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Image
          source={require("../../assets/brand-logo.png")}
          style={{ width: 55, height: 62, resizeMode: "contain" }}
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void finish();
          }}
          style={{ padding: 16 }}
        >
          <Label muted>Atla</Label>
        </Pressable>
      </View>
      <View
        style={{
          minHeight: 240,
          alignItems: "center",
          justifyContent: "center",
          marginVertical: 12,
        }}
      >
        <View
          style={{
            width: 208,
            height: 208,
            borderWidth: 1,
            borderColor: theme.colors.border,
            borderRadius: 104,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <View
            style={{
              width: 148,
              height: 148,
              borderRadius: 40,
              backgroundColor: theme.colors.orangeTint,
              alignItems: "center",
              justifyContent: "center",
              transform: [{ rotate: "-8deg" }],
            }}
          >
            <Icon name={slide.icon} color={theme.colors.primary} size={64} />
          </View>
        </View>
      </View>
      <View style={{ gap: 16 }}>
        <Label
          style={{
            color: theme.colors.primary,
            fontSize: 10,
            letterSpacing: 2,
          }}
        >
          {slide.overline}
        </Label>
        <Heading>{slide.title}</Heading>
        <Label muted>{slide.description}</Label>
      </View>
      <View style={{ flexDirection: "row", gap: 6, marginVertical: 10 }}>
        {slides.map((_, i) => (
          <View
            key={i}
            style={{
              width: i === index ? 26 : 6,
              height: 6,
              borderRadius: 3,
              backgroundColor:
                i === index ? theme.colors.primary : theme.colors.border,
            }}
          />
        ))}
      </View>
      <Button
        title={index === 2 ? "Hesabına giriş yap" : "Devam et"}
        icon="arrow-right"
        onPress={() => {
          if (index < 2) setIndex(index + 1);
          else void finish();
        }}
      />
      <DemoNotice />
    </Screen>
  );
}
