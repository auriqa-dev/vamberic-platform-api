import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { AuthSession } from "./session";
import { Button } from "@/components/ui/button";

const AuthContext = createContext<AuthSession | null>(null);

export function useAuth() {
  const session = useContext(AuthContext);
  if (!session) throw new Error("Authentication provider is required");
  return session;
}

export function AuthGate({
  session,
  children,
}: {
  session: AuthSession;
  children: ReactNode;
}) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEffect(() => {
    void session.start(window.location.href);
  }, [session]);

  return (
    <AuthContext.Provider value={session}>
      {state.status === "authenticated" ? (
        children
      ) : (
        <div className="min-h-screen bg-background flex items-center justify-center p-6">
          <div className="max-w-sm space-y-5 text-center">
            <h1 className="text-3xl font-bold">Vamberic Vapp</h1>
            <p role="status" className="text-muted-foreground">
              {state.status === "loading"
                ? "Checking your session…"
                : state.message || "Sign in to Vapp to continue."}
            </p>
            <Button
              disabled={state.status === "loading"}
              onClick={() => void session.signIn()}
            >
              Sign in
            </Button>
          </div>
        </div>
      )}
    </AuthContext.Provider>
  );
}
