import { View, Pressable, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import type { Promotion } from "@stech/contracts";
import { Badge, Icon, Label } from "./ui";
import { theme as th } from "../theme";
export function PromotionCard({
  promotion,
  compact = false,
}: {
  promotion: Promotion;
  compact?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={promotion.title + ". Kampanya koşullarını gör"}
      onPress={() =>
        router.push({ pathname: "/campaign", params: { id: promotion.id } })
      }
    >
      <LinearGradient
        colors={["#302519", "#191C22", "#132234"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.card, compact && { minHeight: 180 }]}
      >
        <View style={styles.orbit} />
        <View style={styles.orbitSmall} />
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Badge>ÜYELERE ÖZEL</Badge>
          <Icon name="arrow-up-right" color={th.colors.gold} size={20} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Label
              style={{
                fontFamily: th.font.display,
                fontSize: compact ? 25 : 31,
                lineHeight: compact ? 27 : 33,
                maxWidth: 240,
              }}
            >
              {promotion.title}
            </Label>
            <Label
              muted
              style={{
                fontSize: 11,
                lineHeight: 18,
                marginTop: 8,
                maxWidth: 220,
              }}
            >
              {promotion.description}
            </Label>
          </View>
          <View style={{ alignItems: "center" }}>
            <Label
              style={{
                color: th.colors.primary,
                fontFamily: th.font.display,
                fontSize: 58,
                lineHeight: 64,
              }}
            >
              %{promotion.bonusPercent}
            </Label>
            <Label
              style={{
                color: th.colors.gold,
                fontFamily: th.font.bold,
                fontSize: 10,
                letterSpacing: 3,
              }}
            >
              BONUS
            </Label>
          </View>
        </View>
      </LinearGradient>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    padding: 20,
    gap: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#4B3924",
    minHeight: 210,
  },
  orbit: {
    position: "absolute",
    width: 230,
    height: 230,
    borderRadius: 120,
    borderWidth: 1,
    borderColor: "#FFAA1620",
    right: -90,
    top: -80,
  },
  orbitSmall: {
    position: "absolute",
    width: 190,
    height: 190,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: "#FFAA1615",
    right: -70,
    top: -60,
  },
});
