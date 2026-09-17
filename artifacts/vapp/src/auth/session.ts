import type { User, UserManager } from "oidc-client-ts";

export type SessionSnapshot = {
  status: "loading" | "authenticated" | "anonymous";
  subject?: string;
  message?: string;
};

type SessionManager = Pick<
  UserManager,
  | "getUser"
  | "removeUser"
  | "signinRedirect"
  | "signinRedirectCallback"
  | "clearStaleState"
  | "revokeTokens"
>;

/** Browser-independent session state; the provider owns protocol validation. */
export class AuthSession {
  private snapshot: SessionSnapshot = { status: "loading" };
  private listeners = new Set<() => void>();
  private user: User | null = null;
  private initialization?: Promise<void>;
  private expiration?: ReturnType<typeof setTimeout>;
  private generation = 0;

  constructor(
    private readonly manager: SessionManager,
    private readonly navigation: {
      callbackUrl: string;
      logoutUrl: string;
      replace: (url: string) => void;
      assign: (url: string) => void;
    },
    private readonly clearPrivateData: () => void,
  ) {}

  getSnapshot = (): SessionSnapshot => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(snapshot: SessionSnapshot) {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }

  start(url: string): Promise<void> {
    // Callback codes must only be exchanged once, including React remounts.
    return (this.initialization ??= this.initialize(url));
  }

  private async initialize(url: string) {
    const generation = this.generation;
    const current = new URL(url);
    const callback =
      current.searchParams.has("code") || current.searchParams.has("error");
    try {
      const user = callback
        ? await this.manager.signinRedirectCallback(url)
        : await this.manager.getUser();
      if (generation !== this.generation) {
        // A completed callback may persist tokens after sign-out removed them.
        await this.manager.removeUser().catch(() => undefined);
        return;
      }
      if (
        !user ||
        !user.access_token ||
        !user.expires_at ||
        user.expired ||
        !user.profile.sub
      ) {
        await this.invalidate();
        return;
      }
      this.user = user;
      this.publish({ status: "authenticated", subject: user.profile.sub });
      this.expiration = setTimeout(
        () => {
          void this.invalidate("Your session expired. Please sign in again.");
        },
        Math.min(
          Math.max(user.expires_at * 1000 - Date.now(), 0),
          2_147_483_647,
        ),
      );
      await this.manager.clearStaleState();
    } catch {
      await this.invalidate(
        "Sign-in could not be completed. Please try again.",
      );
    } finally {
      // Remove codes, state and provider errors from browser history.
      if (callback) this.navigation.replace(this.navigation.callbackUrl);
    }
  }

  signIn = async () => {
    this.publish({ status: "loading" });
    try {
      await this.manager.signinRedirect();
    } catch {
      await this.invalidate("Sign-in is unavailable. Please try again.");
    }
  };

  getAccessToken = async (): Promise<string | null> => {
    if (this.snapshot.status !== "authenticated") return null;
    if (!this.user || this.user.expired || !this.user.expires_at) {
      await this.invalidate("Your session expired. Please sign in again.");
      return null;
    }
    return this.user.access_token;
  };

  invalidate = async (message = "Please sign in to continue.") => {
    this.generation++;
    clearTimeout(this.expiration);
    this.user = null;
    this.publish({ status: "anonymous", message });
    this.clearPrivateData();
    await this.manager.removeUser().catch(() => undefined);
  };

  signOut = async () => {
    // Capture the refresh-token revocation before clearing persisted state.
    const revocation = this.manager
      .revokeTokens(["refresh_token"])
      .catch(() => undefined);
    await this.invalidate("You have signed out.");
    await revocation;
    // oidc-client-ts persists the user again after successful revocation.
    await this.manager.removeUser().catch(() => undefined);
    this.navigation.assign(this.navigation.logoutUrl);
  };
}
