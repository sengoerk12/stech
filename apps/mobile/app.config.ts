import type { ExpoConfig } from "expo/config";
const environment = process.env.EXPO_PUBLIC_ENVIRONMENT ?? "development";
if (environment !== "development")
  throw new Error(
    "Release disabled: configure real payment/cafe integrations, legal content and persistent backend first.",
  );
const config: ExpoConfig = {
  name: "S TECH",
  slug: "stech-mobile",
  version: "0.1.0",
  scheme: "stech",
  orientation: "portrait",
  userInterfaceStyle: "dark",
  ios: { supportsTablet: false, bundleIdentifier: "com.stech.mobile.dev" },
  android: { package: "com.stech.mobile.dev" },
  web: {
    bundler: "metro",
    name: "S TECH · Oyunun kontrolü sende",
    themeColor: "#090C12",
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-font",
    [
      "expo-splash-screen",
      {
        backgroundColor: "#090C12",
        image: "./assets/brand-logo.png",
        imageWidth: 140,
      },
    ],
  ],
  extra: { environment },
};
export default config;
