import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
const key = "stech.onboarding.v1";
export async function hasOnboarded() {
  if (Platform.OS === "web")
    return (
      typeof localStorage !== "undefined" && localStorage.getItem(key) === "yes"
    );
  return (await SecureStore.getItemAsync(key)) === "yes";
}
export async function completeOnboarding() {
  if (Platform.OS === "web") {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, "yes");
  } else await SecureStore.setItemAsync(key, "yes");
}
