import type { ComponentProps } from "react";
import { Pressable, View, StyleSheet } from "react-native";
import { Icon, Label } from "./ui";
import { theme } from "../theme";
export function MenuRow({
  title,
  subtitle,
  icon,
  onPress,
  expanded,
  last = false,
}: {
  title: string;
  subtitle?: string;
  icon: ComponentProps<typeof Icon>["name"];
  onPress: () => void;
  expanded?: boolean;
  last?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      onPress={onPress}
      style={({ pressed }) => [
        s.row,
        !last && s.border,
        pressed && { backgroundColor: theme.colors.elevated },
      ]}
    >
      <View style={s.icon}>
        <Icon name={icon} size={21} color={theme.colors.accent} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Label style={{ fontFamily: theme.font.medium, fontSize: 15 }}>
          {title}
        </Label>
        {!!subtitle && (
          <Label muted style={{ fontSize: 12, lineHeight: 18 }}>
            {subtitle}
          </Label>
        )}
      </View>
      <Icon name={expanded ? "chevron-down" : "chevron-right"} size={18} />
    </Pressable>
  );
}
const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 18,
    minHeight: 76,
  },
  border: { borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: theme.colors.blueTint,
    alignItems: "center",
    justifyContent: "center",
  },
});
