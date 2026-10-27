import { useEffect, useState } from "react";
import { View, Image, Pressable, Switch } from "react-native";
import { Redirect, router } from "expo-router";
import {
  Screen,
  Label,
  Heading,
  Field,
  Button,
  DemoNotice,
  Icon,
  Card,
} from "../components/ui";
import { theme } from "../theme";
import { useAuth } from "../features/auth/context";
import { t } from "../i18n";
import { hasOnboarded } from "../features/auth/onboarding";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
export default function Login() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    staleTime: 10000,
  });
  const { signedIn, signIn } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    hasOnboarded()
      .then((done) => {
        if (!done) router.replace("/onboarding");
      })
      .catch(() => undefined);
  }, []);
  if (signedIn) return <Redirect href="/" />;
  async function submit() {
    setError("");
    setBusy(true);
    try {
      await signIn(identifier.trim(), password, remember);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      <View style={{ alignItems: "center", marginTop: 20, gap: 12 }}>
        <Image
          source={require("../../assets/brand-logo.png")}
          style={{ width: 112, height: 124, resizeMode: "contain" }}
        />
        <Label
          style={{
            color: theme.colors.primary,
            fontSize: 10,
            letterSpacing: 3,
          }}
        >
          1999’DAN BERİ OYUNUN İÇİNDE
        </Label>
      </View>
      <View style={{ gap: 12, marginTop: 20 }}>
        <Heading>{t("loginTitle")}</Heading>
        <Label muted>{t("loginSubtitle")}</Label>
      </View>
      <View style={{ gap: 18 }}>
        <Field
          label={t("identifier")}
          value={identifier}
          onChangeText={setIdentifier}
          autoCapitalize="none"
          autoComplete="username"
          placeholder="Kullanıcı adını gir"
        />
        <View style={{ gap: 4 }}>
          <Field
            label={t("password")}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!visible}
            autoComplete="current-password"
            onSubmitEditing={() => {
              void submit();
            }}
            placeholder="Şifreni gir"
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => setVisible(!visible)}
            style={{ alignSelf: "flex-end", padding: 8 }}
          >
            <Label muted style={{ fontSize: 11 }}>
              {visible ? "Şifreyi gizle" : "Şifreyi göster"}
            </Label>
          </Pressable>
        </View>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Switch
              accessibilityLabel={t("remember")}
              value={remember}
              onValueChange={setRemember}
              trackColor={{ true: theme.colors.primary }}
            />
            <Label style={{ fontSize: 12 }}>{t("remember")}</Label>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("/support")}
          >
            <Label style={{ color: theme.colors.primary, fontSize: 12 }}>
              Şifremi unuttum
            </Label>
          </Pressable>
        </View>
        {!!error && (
          <Label style={{ color: theme.colors.error }}>{error}</Label>
        )}
        <Button
          title={t("login")}
          busy={busy}
          disabled={!identifier || !password}
          onPress={() => {
            void submit();
          }}
          icon="arrow-right"
        />
      </View>
      <Button
        title="Hesabın yok mu? Kayıt ol"
        secondary
        onPress={() => router.push("/register")}
      />
      {health.data?.cafe === "mock" && (
        <Card style={{ gap: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Icon name="info" color={theme.colors.accent} size={16} />
            <Label style={{ fontSize: 12 }}>Demo hesabı</Label>
          </View>
          <Label muted style={{ fontSize: 12 }}>
            Kullanıcı adı: demo · Şifre: StechDemo2026!
          </Label>
        </Card>
      )}
      <DemoNotice />
    </Screen>
  );
}
