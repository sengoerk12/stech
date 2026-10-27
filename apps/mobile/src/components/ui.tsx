import React from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  type TextInputProps,
  type StyleProp,
  type ViewStyle,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Feather from "@expo/vector-icons/Feather";
import { theme as th } from "../theme";
import { t } from "../i18n";
export function Label({
  children,
  muted = false,
  style,
}: React.PropsWithChildren<{
  muted?: boolean;
  style?: React.ComponentProps<typeof Text>["style"];
}>) {
  return (
    <Text style={[s.text, muted && { color: th.colors.muted }, style]}>
      {children}
    </Text>
  );
}
export function Heading({
  children,
  small = false,
}: React.PropsWithChildren<{ small?: boolean }>) {
  return (
    <Text
      accessibilityRole="header"
      style={[s.heading, small && { fontSize: 23, flexShrink: 1 }]}
    >
      {children}
    </Text>
  );
}
export function Icon({
  name,
  color = th.colors.muted,
  size = 22,
}: {
  name: React.ComponentProps<typeof Feather>["name"];
  color?: React.ComponentProps<typeof Feather>["color"];
  size?: number;
}) {
  return <Feather name={name} color={color} size={size} />;
}
export function Button({
  title,
  onPress,
  secondary = false,
  disabled = false,
  busy = false,
  icon,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  busy?: boolean;
  icon?: React.ComponentProps<typeof Feather>["name"];
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        s.button,
        secondary && s.secondary,
        (disabled || busy) && { opacity: 0.5 },
        pressed && { opacity: 0.8, transform: [{ scale: 0.99 }] },
      ]}
    >
      <Text style={[s.buttonText, secondary && { color: th.colors.text }]}>
        {busy ? "İşleniyor…" : title}
      </Text>
      {icon && (
        <Icon
          name={icon}
          color={secondary ? th.colors.text : th.colors.background}
          size={19}
        />
      )}
    </Pressable>
  );
}
export function Card({
  children,
  style,
}: React.PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[s.card, style]}>{children}</View>;
}
export function Badge({
  children,
  blue = false,
}: React.PropsWithChildren<{ blue?: boolean }>) {
  return (
    <View style={[s.badge, blue && { backgroundColor: th.colors.blueTint }]}>
      <Text
        style={{
          color: blue ? th.colors.accent : th.colors.gold,
          fontSize: 10,
          letterSpacing: 1.1,
          fontFamily: th.font.bold,
        }}
      >
        {children}
      </Text>
    </View>
  );
}
export function Screen({
  children,
  refreshing,
  onRefresh,
  footer,
}: React.PropsWithChildren<{
  refreshing?: boolean;
  onRefresh?: () => void;
  footer?: React.ReactNode;
}>) {
  return (
    <SafeAreaView style={s.safe} edges={["top", "left", "right"]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={s.content}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing ?? false}
              onRefresh={onRefresh}
              tintColor={th.colors.primary}
            />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
      {footer && (
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: th.colors.border,
            backgroundColor: th.colors.background,
          }}
        >
          <View
            style={{
              width: "100%",
              maxWidth: 540,
              alignSelf: "center",
              padding: 18,
            }}
          >
            {footer}
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 9 }}>
      <Label style={{ fontSize: 13, fontFamily: th.font.medium }}>
        {label}
      </Label>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={th.colors.faint}
        selectionColor={th.colors.primary}
        style={s.input}
        {...props}
      />
    </View>
  );
}
export function Section({
  title,
  action,
  onPress,
}: {
  title: string;
  action?: string;
  onPress?: () => void;
}) {
  return (
    <View style={s.section}>
      <Heading small>{title}</Heading>
      {action && (
        <Pressable
          accessibilityRole="button"
          onPress={onPress}
          style={{ minHeight: 48, justifyContent: "center" }}
        >
          <Label style={{ color: th.colors.primary, fontSize: 12 }}>
            {action} →
          </Label>
        </Pressable>
      )}
    </View>
  );
}
export function ErrorState({
  message,
  retry,
}: {
  message?: string;
  retry?: () => void;
}) {
  return (
    <Card style={{ gap: 16 }}>
      <Icon name="wifi-off" color={th.colors.error} />
      <Label>{message ?? t("error")}</Label>
      {retry && <Button title={t("retry")} onPress={retry} secondary />}
    </Card>
  );
}
export function Skeleton() {
  return (
    <View accessibilityLabel="İçerik yükleniyor" style={{ gap: 20 }}>
      <View style={[s.skeleton, { height: 46, width: "60%" }]} />
      <View style={[s.skeleton, { height: 220 }]} />
      <View style={[s.skeleton, { height: 140 }]} />
    </View>
  );
}
export function DemoNotice() {
  return <Text style={s.demo}>{t("demo")}</Text>;
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: th.colors.background },
  content: {
    padding: 22,
    paddingBottom: 32,
    gap: 24,
    width: "100%",
    maxWidth: 540,
    alignSelf: "center",
  },
  text: {
    color: th.colors.text,
    fontFamily: th.font.regular,
    fontSize: 14,
    lineHeight: 22,
  },
  heading: {
    color: th.colors.text,
    fontFamily: th.font.display,
    fontSize: 34,
    lineHeight: 38,
  },
  button: {
    minHeight: 54,
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: th.colors.primary,
    borderRadius: th.radius.control,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  buttonText: {
    color: th.colors.background,
    fontFamily: th.font.bold,
    fontSize: 14,
  },
  secondary: {
    backgroundColor: th.colors.elevated,
    borderWidth: 1,
    borderColor: th.colors.border,
  },
  card: {
    backgroundColor: th.colors.surface,
    padding: 20,
    borderRadius: th.radius.card,
    borderWidth: 1,
    borderColor: th.colors.border,
  },
  badge: {
    backgroundColor: th.colors.orangeTint,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  input: {
    backgroundColor: th.colors.surface,
    borderColor: th.colors.border,
    borderWidth: 1,
    borderRadius: 12,
    color: th.colors.text,
    padding: 16,
    minHeight: 54,
    fontFamily: th.font.regular,
    fontSize: 16,
  },
  section: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  skeleton: { backgroundColor: th.colors.elevated, borderRadius: 18 },
  demo: {
    textAlign: "center",
    fontFamily: th.font.medium,
    color: th.colors.faint,
    fontSize: 10,
    letterSpacing: 0.6,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
});
export const ui = s;
