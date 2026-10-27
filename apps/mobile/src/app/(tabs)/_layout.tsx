import { Tabs, Redirect } from "expo-router";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../features/auth/context";
import { theme } from "../../theme";
import { Icon, Screen, Skeleton } from "../../components/ui";
import { t } from "../../i18n";
export default function TabLayout() {
  const { ready, signedIn } = useAuth();
  const insets = useSafeAreaInsets();
  if (!ready)
    return (
      <Screen>
        <Skeleton />
      </Screen>
    );
  if (!signedIn) return <Redirect href="/login" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.faint,
        tabBarStyle: {
          backgroundColor: theme.colors.background,
          borderTopColor: theme.colors.border,
          height: 68 + Math.max(12, insets.bottom),
          paddingTop: 10,
          paddingBottom: Math.max(12, insets.bottom),
        },
        tabBarLabelStyle: { fontFamily: theme.font.medium, fontSize: 10 },
        sceneStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("home"),
          tabBarIcon: ({ color }) => (
            <Icon
              name="home"
              color={typeof color === "string" ? color : theme.colors.muted}
              size={21}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="campaigns"
        options={{
          title: t("campaigns"),
          tabBarIcon: ({ color }) => (
            <Icon
              name="gift"
              color={typeof color === "string" ? color : theme.colors.muted}
              size={21}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="topup"
        options={{
          title: "Yükle",
          tabBarIcon: () => (
            <View
              style={{
                backgroundColor: theme.colors.primary,
                borderRadius: 13,
                padding: 8,
                marginTop: -12,
              }}
            >
              <Icon name="plus" color={theme.colors.background} size={25} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="transactions"
        options={{
          title: t("transactions"),
          tabBarIcon: ({ color }) => (
            <Icon
              name="list"
              color={typeof color === "string" ? color : theme.colors.muted}
              size={21}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t("profile"),
          tabBarIcon: ({ color }) => (
            <Icon
              name="user"
              color={typeof color === "string" ? color : theme.colors.muted}
              size={21}
            />
          ),
        }}
      />
    </Tabs>
  );
}
