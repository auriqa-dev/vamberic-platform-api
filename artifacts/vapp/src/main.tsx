import { createRoot } from "react-dom/client";
import {
  setBaseUrl,
  setAuthTokenGetter,
  setUnauthorizedHandler,
} from "@workspace/api-client-react";

import { configureAuth } from "./auth/config";
import { AuthGate } from "./auth/provider";
import type { AuthSession } from "./auth/session";
import { queryClient } from "./lib/query-client";
import App from "./App";
import { ErrorBoundary } from "@/components/error-boundary";

import "./index.css";

let session: AuthSession | null = null;
try {
  const auth = configureAuth(import.meta.env, () => {
    queryClient.clear();
  });
  session = auth.session;
  setBaseUrl(auth.apiBaseUrl);
  setAuthTokenGetter(session.getAccessToken);
  setUnauthorizedHandler(() =>
    auth.session.invalidate(
      "Your session is no longer valid. Please sign in again.",
    ),
  );
} catch {
  // Configuration and provider errors must not leak values to the UI or logs.
}

createRoot(document.getElementById("root")!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    {session ? (
      <AuthGate session={session}>
        <App />
      </AuthGate>
    ) : (
      <main className="min-h-screen flex items-center justify-center p-6">
        <p role="alert">
          Vapp sign-in is not configured. Contact your administrator.
        </p>
      </main>
    )}
  </ErrorBoundary>,
);
