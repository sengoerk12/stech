import { useRef, useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MemberProfile, ProfileUpdateInput } from "@stech/contracts";
import {
  Screen,
  Heading,
  Label,
  Card,
  Field,
  Button,
  Skeleton,
  ErrorState,
} from "../components/ui";
import { api } from "../services/api";
import { createUuid } from "../services/uuid";
import { useAuth } from "../features/auth/context";
import { theme } from "../theme";

export default function ProfileEdit() {
  const query = useQuery({
    queryKey: ["member-profile"],
    queryFn: api.profile,
    refetchOnWindowFocus: false,
  });
  const client = useQueryClient(),
    { signOut } = useAuth();
  const [draft, setDraft] = useState<MemberProfile | null>(null),
    [currentPassword, setCurrentPassword] = useState(""),
    [verification, setVerification] = useState<"password" | "card">("password"),
    [cardUid, setCardUid] = useState(""),
    [cardCaptured, setCardCaptured] = useState(false),
    [newPassword, setNewPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [locked, setLocked] = useState(false);
  const attempt = useRef<ProfileUpdateInput | null>(null);
  const form = draft ?? query.data;
  function change(key: keyof MemberProfile, value: string) {
    if (form) {
      setDraft({ ...form, [key]: value });
      setSaved(false);
    }
  }
  async function save() {
    if (!form || busy) return;
    setError("");
    if (!attempt.current) {
      if (!form.firstName.trim() || !form.lastName.trim())
        return setError("Adını ve soyadını ayrı ayrı gir.");
      if (verification === "password" && !currentPassword)
        return setError("Her değişiklikte mevcut şifreni yeniden gir.");
      if (
        verification === "card" &&
        (!cardCaptured || !/^[A-Z0-9_-]{4,64}$/.test(cardUid))
      )
        return setError("Kart okuyucu alanına dokunup üyelik kartını okut.");
      if (newPassword && (newPassword.length < 8 || newPassword.length > 32))
        return setError("Yeni şifre 8–32 karakter olmalı.");
      if (newPassword !== confirmation)
        return setError("Yeni şifreler eşleşmiyor.");
      attempt.current = {
        operationId: createUuid(),
        revision: form.revision,
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone,
        address: form.address,
        nationalId: form.nationalId,
        ...(verification === "password" ? { currentPassword } : { cardUid }),
        ...(newPassword ? { newPassword } : {}),
      };
    }
    setBusy(true);
    setLocked(true);
    try {
      const result = await api.updateProfile(attempt.current);
      attempt.current = null;
      setCurrentPassword("");
      setCardUid("");
      setCardCaptured(false);
      setNewPassword("");
      setConfirmation("");
      if (result.passwordChanged) {
        await signOut().catch(() => {});
        router.replace("/login");
        return;
      }
      await client.invalidateQueries({ queryKey: ["dashboard"] });
      const latest = await query.refetch();
      setDraft(latest.data ?? null);
      setSaved(true);
      setLocked(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Değişiklik kaydedilemedi.");
      const status = (e as { status?: number }).status;
      if (status === 400 || status === 409) {
        attempt.current = null;
        setLocked(false);
        setCurrentPassword("");
        setCardUid("");
        setCardCaptured(false);
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      <Button title="Profilime dön" secondary onPress={() => router.back()} />
      <Heading>Üyelik bilgilerim</Heading>
      <Label muted>Bilgilerin PanCafe hesabınla birlikte güncellenir.</Label>
      {query.isPending ? (
        <Skeleton />
      ) : query.error ? (
        <ErrorState
          message={query.error.message}
          retry={() => void query.refetch()}
        />
      ) : (
        form && (
          <>
            <Card style={{ gap: 8 }}>
              <Label muted>Üye no</Label>
              <Label>{form.memberNumber || "PanCafe bağlantısı yok"}</Label>
              <Label muted>@{form.username}</Label>
            </Card>
            <View style={{ gap: 18 }}>
              <Field
                label="Ad"
                value={form.firstName}
                onChangeText={(v) => change("firstName", v)}
                maxLength={32}
                editable={!busy && !locked}
                autoComplete="given-name"
              />
              <Field
                label="Soyad"
                value={form.lastName}
                onChangeText={(v) => change("lastName", v)}
                maxLength={32}
                editable={!busy && !locked}
                autoComplete="family-name"
              />
              <Field
                label="Telefon"
                value={form.phone}
                onChangeText={(v) => change("phone", v)}
                keyboardType="phone-pad"
                maxLength={20}
                editable={!busy && !locked}
                autoComplete="tel"
                placeholder="05xx xxx xx xx"
              />
              <Field
                label="T.C. kimlik numarası (isteğe bağlı)"
                value={form.nationalId}
                onChangeText={(v) => change("nationalId", v.replace(/\D/g, ""))}
                keyboardType="number-pad"
                maxLength={11}
                editable={!busy && !locked}
              />
              <Field
                label="Adres (isteğe bağlı)"
                value={form.address}
                onChangeText={(v) => change("address", v)}
                multiline
                numberOfLines={4}
                maxLength={1024}
                editable={!busy && !locked}
              />
              <Card style={{ gap: 12 }}>
                <Label>Her değişiklikte kimliğini doğrula</Label>
                <Label muted>
                  Mevcut şifreni gir veya bu hesaba bağlı üyelik kartını okut.
                </Label>
                <Button
                  title="Şifreyle doğrula"
                  secondary={verification !== "password"}
                  disabled={busy || locked}
                  onPress={() => {
                    setVerification("password");
                    setCardUid("");
                    setCardCaptured(false);
                    setCurrentPassword("");
                  }}
                />
                <Button
                  title="Üyelik kartıyla doğrula"
                  secondary={verification !== "card"}
                  disabled={busy || locked}
                  onPress={() => {
                    setVerification("card");
                    setCurrentPassword("");
                    setCardUid("");
                    setCardCaptured(false);
                  }}
                />
                {verification === "password" ? (
                  <Field
                    label="Mevcut şifren"
                    value={currentPassword}
                    onChangeText={setCurrentPassword}
                    secureTextEntry
                    maxLength={32}
                    editable={!busy && !locked}
                    autoComplete="current-password"
                  />
                ) : (
                  <>
                    <Field
                      label="Kart okuyucu"
                      placeholder="Bu alana dokun, kartını okuyucuya okut"
                      value={cardUid}
                      secureTextEntry
                      autoFocus
                      autoCapitalize="characters"
                      autoCorrect={false}
                      autoComplete="off"
                      maxLength={64}
                      showSoftInputOnFocus={false}
                      editable={!busy && !locked}
                      selectTextOnFocus
                      onChangeText={(v) => {
                        setCardUid(v.trim().toUpperCase());
                        setCardCaptured(false);
                      }}
                      onSubmitEditing={() => setCardCaptured(true)}
                    />
                    <Label muted>
                      {cardCaptured
                        ? "Kart okundu. Kaydettiğinde hesabınla eşleşmesi kontrol edilecek."
                        : "USB / klavye modunda çalışan kart okuyucu gerekir. Kart okutma sonunda Enter gönderilmeli."}
                    </Label>
                  </>
                )}
              </Card>
              <Label muted>
                Şifreni değiştirmek istemiyorsan aşağıdaki iki alanı boş bırak.
              </Label>
              <Field
                label="Yeni şifre"
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                maxLength={32}
                editable={!busy && !locked}
                autoComplete="new-password"
              />
              <Field
                label="Yeni şifre tekrar"
                value={confirmation}
                onChangeText={setConfirmation}
                secureTextEntry
                maxLength={32}
                editable={!busy && !locked}
                autoComplete="new-password"
              />
            </View>
            <Label muted>
              Şifre değiştiğinde yeniden giriş yapman istenir. Profil
              değişikliklerin güvenli işlem geçmişine kaydedilir.
            </Label>
            {!!error && (
              <Label style={{ color: theme.colors.error }}>{error}</Label>
            )}
            {saved && <Label>Bilgilerin güncellendi.</Label>}
            {locked && !busy && (
              <Label muted>
                İşlem sonucu belirsizse aynı kaydı tekrar kontrol edebilirsin.
                Bilgiler ikinci kez uygulanmaz.
              </Label>
            )}
            <Button
              title={
                locked && !busy
                  ? "İşlem sonucunu tekrar kontrol et"
                  : "Değişiklikleri kaydet"
              }
              busy={busy}
              onPress={() => void save()}
            />
          </>
        )
      )}
    </Screen>
  );
}
