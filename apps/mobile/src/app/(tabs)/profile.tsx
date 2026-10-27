import { useState } from "react";
import { View, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import {
  Screen,
  Heading,
  Label,
  Card,
  Button,
  Badge,
  Skeleton,
  ErrorState,
  DemoNotice,
} from "../../components/ui";
import { MenuRow } from "../../components/MenuRow";
import { useAuth } from "../../features/auth/context";
import { useDashboard } from "../../hooks/useDashboard";
import { theme } from "../../theme";
export default function Profile() {
  const { data, error, isPending, refetch } = useDashboard();
  const { signOut } = useAuth();
  const [showDetails, setShowDetails] = useState(false);
  const [leaving, setLeaving] = useState(false);
  return (
    <Screen>
      <Heading>Profilim</Heading>
      {isPending ? (
        <Skeleton />
      ) : error ? (
        <ErrorState
          message={error.message}
          retry={() => {
            void refetch();
          }}
        />
      ) : (
        data && (
          <>
            <LinearGradient
              colors={[
                theme.colors.blueTint,
                theme.colors.surface,
                theme.colors.orangeTint,
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={s.hero}
            >
              <Label style={s.eyebrow}>OYUNUN MERKEZİNDE SEN VARSIN</Label>
              <View style={s.identity}>
                <View style={{ flex: 1, gap: 8 }}>
                  <Label style={s.name}>{data.member.name}</Label>
                  <Label muted>@{data.member.username}</Label>
                  {!!data.member.level && (
                    <Badge blue>{data.member.level}</Badge>
                  )}
                </View>
                <View style={s.avatar}>
                  <Label style={s.initial}>
                    {data.member.name
                      .trim()
                      .slice(0, 1)
                      .toLocaleUpperCase("tr-TR")}
                  </Label>
                </View>
              </View>
            </LinearGradient>
            <View style={s.group}>
              <Label style={s.groupTitle}>Hesabım</Label>
              <Card style={s.menu}>
                <MenuRow
                  title="Bilgilerim"
                  subtitle="Hesap ve iletişim bilgilerin"
                  icon="user"
                  expanded={showDetails}
                  onPress={() => setShowDetails(!showDetails)}
                />
                {showDetails && (
                  <View style={s.details}>
                    {[
                      ["Ad soyad", data.member.name],
                      ["Kullanıcı adı", data.member.username],
                      ["Telefon", data.member.phone],
                      ["E-posta", data.member.email],
                      [
                        "Üyelik tarihi",
                        new Date(data.member.joinedAt).toLocaleDateString(
                          "tr-TR",
                        ),
                      ],
                    ]
                      .filter(([, value]) => !!value)
                      .map(([label, value]) => (
                        <View key={label} style={{ gap: 4 }}>
                          <Label muted style={{ fontSize: 12 }}>
                            {label}
                          </Label>
                          <Label>{value}</Label>
                        </View>
                      ))}
                  </View>
                )}
                <MenuRow
                  title="Bildirim tercihlerim"
                  subtitle="Kampanya ve işlem bildirimleri"
                  icon="bell"
                  onPress={() => router.push("/notifications")}
                />
                <MenuRow
                  title="Hesap ve şifre desteği"
                  subtitle="Giriş işlemleri için yardım al"
                  icon="lock"
                  last
                  onPress={() => router.push("/support")}
                />
              </Card>
            </View>
            <View style={s.group}>
              <Label style={s.groupTitle}>Yardım ve güvenlik</Label>
              <Card style={s.menu}>
                <MenuRow
                  title="Destek"
                  icon="help-circle"
                  onPress={() => router.push("/support")}
                />
                <MenuRow
                  title="Gizlilik ve kullanım bilgileri"
                  icon="shield"
                  last
                  onPress={() => router.push("/legal")}
                />
              </Card>
            </View>
            <Button
              title="Çıkış yap"
              secondary
              icon="log-out"
              busy={leaving}
              onPress={() => {
                setLeaving(true);
                void signOut()
                  .catch(() => undefined)
                  .finally(() => setLeaving(false));
              }}
            />
            <DemoNotice />
          </>
        )
      )}
    </Screen>
  );
}
const s = StyleSheet.create({
  hero: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 22,
    gap: 24,
  },
  eyebrow: {
    fontSize: 10,
    lineHeight: 16,
    letterSpacing: 1.5,
    color: theme.colors.accent,
    fontFamily: theme.font.bold,
  },
  identity: { flexDirection: "row", alignItems: "center", gap: 16 },
  name: { fontFamily: theme.font.bold, fontSize: 25, lineHeight: 34 },
  avatar: {
    width: 64,
    height: 72,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  initial: {
    fontSize: 32,
    lineHeight: 42,
    fontFamily: theme.font.bold,
    color: theme.colors.primary,
  },
  group: { gap: 12 },
  groupTitle: {
    fontSize: 14,
    fontFamily: theme.font.bold,
    color: theme.colors.muted,
  },
  menu: { padding: 0, overflow: "hidden" },
  details: {
    padding: 20,
    gap: 18,
    backgroundColor: theme.colors.background,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
});
