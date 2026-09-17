import { UserManager, WebStorageStateStore } from "oidc-client-ts";
import { z } from "zod";
import { AuthSession } from "./session";

function secureUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.hash &&
      !url.search &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}

const schema = z.object({
  VITE_PLATFORM_API_BASE_URL: z
    .string()
    .refine(secureUrl)
    .refine((value) => new URL(value).pathname === "/"),
  VITE_COGNITO_REGION: z.string().regex(/^[a-z]{2}(?:-[a-z]+)+-\d$/),
  VITE_COGNITO_USER_POOL_ID: z
    .string()
    .regex(/^[a-z]{2}(?:-[a-z]+)+-\d_[A-Za-z0-9]+$/),
  VITE_COGNITO_CLIENT_ID: z.string().regex(/^[a-z0-9]+$/),
  VITE_COGNITO_DOMAIN: z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        secureUrl(value) && url.protocol === "https:" && url.pathname === "/"
      );
    }),
});

export function configureAuth(
  environment: Record<string, unknown>,
  clearPrivateData: () => void,
) {
  const config = schema.parse(environment);
  if (
    !config.VITE_COGNITO_USER_POOL_ID.startsWith(
      `${config.VITE_COGNITO_REGION}_`,
    )
  ) {
    throw new Error("Cognito region mismatch");
  }
  const callbackUrl = new URL(import.meta.env.BASE_URL, window.location.origin)
    .href;
  const authority = `https://cognito-idp.${config.VITE_COGNITO_REGION}.amazonaws.com/${config.VITE_COGNITO_USER_POOL_ID}`;
  const domain = config.VITE_COGNITO_DOMAIN.replace(/\/$/, "");
  const manager = new UserManager({
    authority,
    client_id: config.VITE_COGNITO_CLIENT_ID,
    redirect_uri: callbackUrl,
    response_type: "code",
    scope: "openid email profile",
    disablePKCE: false,
    automaticSilentRenew: false,
    loadUserInfo: false,
    monitorSession: false,
    revokeTokenTypes: ["refresh_token"],
    requestTimeoutInSeconds: 10,
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
    metadata: {
      issuer: authority,
      authorization_endpoint: `${domain}/oauth2/authorize`,
      token_endpoint: `${domain}/oauth2/token`,
      revocation_endpoint: `${domain}/oauth2/revoke`,
      jwks_uri: `${authority}/.well-known/jwks.json`,
    },
  });
  const logoutUrl = new URL(`${domain}/logout`);
  logoutUrl.searchParams.set("client_id", config.VITE_COGNITO_CLIENT_ID);
  logoutUrl.searchParams.set("logout_uri", callbackUrl);
  return {
    apiBaseUrl: config.VITE_PLATFORM_API_BASE_URL,
    session: new AuthSession(
      manager,
      {
        callbackUrl,
        logoutUrl: logoutUrl.href,
        replace: (url) => window.history.replaceState(null, "", url),
        assign: (url) => window.location.assign(url),
      },
      clearPrivateData,
    ),
  };
}
