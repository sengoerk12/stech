import { useState } from "react";
import { View } from "react-native";
import { Redirect, router } from "expo-router";
import {
  Screen,
  Heading,
  Label,
  Field,
  Button,
  Card,
  Icon,
  DemoNotice,
} from "../components/ui";
import { useAuth } from "../features/auth/context";
import { theme } from "../theme";

export default function Register() {
  const { signedIn, signUp } = useAuth();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (signedIn) return <Redirect href="/" />;
  async function submit() {
    if (busy) return;
    setError("");
    if (name.trim().length < 2) return setError("Adını ve soyadını gir.");
    if (!/^[a-zA-Z0-9_.]{3,32}$/.test(username.trim()))
      return setError(
        "Kullanıcı adın 3–32 karakter olmalı. İngilizce harf, rakam, nokta ve alt çizgi kullanabilirsin.",
      );
    if (password.length < 8 || !password.trim())
      return setError("Şifren en az 8 karakter olmalı.");
    if (password !== confirmation)
      return setError("Şifreler eşleşmiyor. Tekrar kontrol et.");
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return setError("Geçerli bir e-posta adresi gir.");
    if (phone.trim() && !/^\+?[0-9 ()-]{10,20}$/.test(phone.trim()))
      return setError("Telefon numaranı kontrol et.");
    setBusy(true);
    try {
      await signUp({
        name: name.trim(),
        username: username.trim(),
        password,
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
      });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Hesap oluşturulamadı. Tekrar dene.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      <Button
        title="Girişe dön"
        icon="arrow-left"
        secondary
        onPress={() => router.replace("/login")}
      />
      <View style={{ gap: 10 }}>
        <Label style={{ color: theme.colors.primary, letterSpacing: 3 }}>
          S TECH E-SPOR
        </Label>
        <Heading>Aramıza katıl</Heading>
        <Label muted>Hesabını oluştur, oyun için yerini al.</Label>
      </View>
      <Card style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
        <Icon name="user-plus" color={theme.colors.accent} />
        <View style={{ flex: 1, gap: 4 }}>
          <Label>Yeni hesap, temiz başlangıç</Label>
          <Label muted style={{ fontSize: 12 }}>
            Bakiyen 0 TL ile başlar. İşlemlerin, ilk yüklemenden sonra burada
            görünür.
          </Label>
        </View>
      </Card>
      <View style={{ gap: 18 }}>
        <Field
          label="Ad soyad"
          placeholder="Adını ve soyadını gir"
          value={name}
          onChangeText={setName}
          maxLength={80}
          autoComplete="name"
          editable={!busy}
        />
        <Field
          label="Kullanıcı adı"
          placeholder="Kendine bir kullanıcı adı seç"
          value={username}
          onChangeText={setUsername}
          maxLength={32}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username-new"
          editable={!busy}
        />
        <Label muted style={{ fontSize: 12 }}>
          3–32 karakter; İngilizce harf, rakam, nokta veya alt çizgi.
        </Label>
        <Field
          label="Telefon (isteğe bağlı)"
          placeholder="05xx xxx xx xx"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          maxLength={20}
          autoComplete="tel"
          editable={!busy}
        />
        <Field
          label="E-posta (isteğe bağlı)"
          placeholder="E-posta adresin"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={254}
          autoComplete="email"
          editable={!busy}
        />
        <Field
          label="Şifre"
          placeholder="En az 8 karakter"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          maxLength={128}
          editable={!busy}
        />
        <Field
          label="Şifre tekrar"
          placeholder="Şifreni tekrar gir"
          value={confirmation}
          onChangeText={setConfirmation}
          secureTextEntry
          autoComplete="new-password"
          maxLength={128}
          editable={!busy}
          onSubmitEditing={() => {
            void submit();
          }}
        />
        {!!error && (
          <View accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Label style={{ color: theme.colors.error }}>{error}</Label>
          </View>
        )}
        <Button
          title="Hesap oluştur"
          icon="arrow-right"
          busy={busy}
          disabled={
            !name.trim() || !username.trim() || !password || !confirmation
          }
          onPress={() => {
            void submit();
          }}
        />
      </View>
      <DemoNotice />
    </Screen>
  );
}
