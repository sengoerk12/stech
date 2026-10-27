import React, { createContext, useContext, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../services/api";
import type { RegistrationInput } from "@stech/contracts";
type AuthContextValue = {
  ready: boolean;
  signedIn: boolean;
  signIn: (id: string, password: string, remember: boolean) => Promise<void>;
  signOut: () => Promise<void>;
  signUp: (input: RegistrationInput) => Promise<void>;
};
const Context = createContext<AuthContextValue | null>(null);
export function AuthProvider({ children }: React.PropsWithChildren) {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const client = useQueryClient();
  useEffect(() => {
    api.onExpired(() => {
      setSignedIn(false);
      client.clear();
    });
    api
      .restore()
      .then(setSignedIn)
      .catch(() => setSignedIn(false))
      .finally(() => setReady(true));
  }, [client]);
  return (
    <Context.Provider
      value={{
        ready,
        signedIn,
        signIn: async (id, password, remember) => {
          await api.login(id, password, remember);
          client.clear();
          setSignedIn(true);
        },
        signUp: async (input) => {
          await api.register(input);
          client.clear();
          setSignedIn(true);
        },
        signOut: async () => {
          try {
            await api.logout();
          } finally {
            setSignedIn(false);
            client.clear();
          }
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useAuth() {
  const context = useContext(Context);
  if (!context) throw new Error("Missing AuthProvider");
  return context;
}
