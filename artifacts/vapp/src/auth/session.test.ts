import assert from "node:assert/strict";
import { test } from "node:test";
import { User } from "oidc-client-ts";
import { AuthSession } from "./session";

function fixture(expired = false) {
  const user = new User({
    access_token: "private-access-token",
    id_token: "private-id-token",
    refresh_token: "private-refresh-token",
    token_type: "Bearer",
    profile: {
      sub: "user-subject",
      iss: "https://issuer.example",
      aud: "client",
      exp: 123,
      iat: 1,
    },
    expires_at: Math.floor(Date.now() / 1000) + (expired ? -10 : 300),
  });
  let stored: User | null = user;
  let cleared = 0;
  let callbacks = 0;
  let signIns = 0;
  let revoked: string[] = [];
  const replaced: string[] = [];
  const assigned: string[] = [];
  const manager = {
    getUser: async () => stored,
    removeUser: async () => {
      stored = null;
    },
    signinRedirect: async () => {
      signIns++;
    },
    signinRedirectCallback: async () => {
      callbacks++;
      return user;
    },
    clearStaleState: async () => undefined,
    revokeTokens: async (types?: string[]) => {
      revoked = types ?? [];
      // Simulate oidc-client-ts persisting its captured user after revocation.
      await new Promise((resolve) => setImmediate(resolve));
      stored = user;
    },
  };
  const session = new AuthSession(
    manager,
    {
      callbackUrl: "https://app.example/",
      logoutUrl:
        "https://login.example/logout?client_id=client&logout_uri=https%3A%2F%2Fapp.example%2F",
      replace: (url) => {
        replaced.push(url);
      },
      assign: (url) => {
        assigned.push(url);
      },
    },
    () => {
      cleared++;
    },
  );
  return {
    session,
    manager,
    replaced,
    assigned,
    counts: () => ({ cleared, callbacks, signIns, revoked }),
    stored: () => stored,
    store: (value: User | null) => {
      stored = value;
    },
  };
}

test("session restoration gates screens and provides only the access token", async () => {
  const f = fixture();
  assert.equal(f.session.getSnapshot().status, "loading");
  assert.equal(await f.session.getAccessToken(), null);
  await f.session.start("https://app.example/");
  assert.deepEqual(f.session.getSnapshot(), {
    status: "authenticated",
    subject: "user-subject",
  });
  assert.equal(await f.session.getAccessToken(), "private-access-token");
  await f.session.invalidate();
  assert.equal(f.session.getSnapshot().status, "anonymous");
  assert.equal(await f.session.getAccessToken(), null);
  assert.equal(f.stored(), null);
  assert.equal(f.counts().cleared, 1);
});

test("callback is processed once and sensitive URL parameters are removed", async () => {
  const f = fixture();
  await Promise.all([
    f.session.start("https://app.example/?code=secret&state=state"),
    f.session.start("https://app.example/?code=secret&state=state"),
  ]);
  assert.equal(f.counts().callbacks, 1);
  assert.deepEqual(f.replaced, ["https://app.example/"]);
  await f.session.invalidate();
});

test("expired sessions and callback failures return a safe login state", async () => {
  const expired = fixture(true);
  await expired.session.start("https://app.example/");
  assert.equal(expired.session.getSnapshot().status, "anonymous");
  assert.equal(await expired.session.getAccessToken(), null);
  const failed = fixture();
  failed.manager.signinRedirectCallback = async () => {
    throw new Error("provider error containing secret token");
  };
  await failed.session.start("https://app.example/?error=secret&state=state");
  assert.equal(failed.session.getSnapshot().status, "anonymous");
  assert.doesNotMatch(
    JSON.stringify(failed.session.getSnapshot()),
    /secret|token/,
  );
  assert.deepEqual(failed.replaced, ["https://app.example/"]);
  await failed.session.signIn();
  assert.equal(failed.counts().signIns, 1);
});

test("sign-out clears local state and private data, revokes refresh token, then redirects", async () => {
  const f = fixture();
  await f.session.start("https://app.example/");
  await f.session.signOut();
  assert.equal(f.session.getSnapshot().status, "anonymous");
  assert.equal(f.stored(), null);
  assert.equal(f.counts().cleared, 1);
  assert.deepEqual(f.counts().revoked, ["refresh_token"]);
  assert.equal(f.assigned.length, 1);
  assert.doesNotMatch(f.assigned[0], /private-/);
});

test("sign-out during restoration cannot restore the previous session", async () => {
  const f = fixture();
  const user = f.stored();
  let resolve!: (user: User | null) => void;
  f.manager.getUser = () =>
    new Promise((r) => {
      resolve = r;
    });
  const start = f.session.start("https://app.example/");
  await f.session.invalidate();
  resolve(user);
  await start;
  assert.equal(f.session.getSnapshot().status, "anonymous");
});

test("a callback completing after sign-out cannot repersist tokens", async () => {
  const f = fixture();
  const user = f.stored()!;
  let complete!: () => void;
  f.manager.signinRedirectCallback = async () => {
    await new Promise<void>((resolve) => {
      complete = resolve;
    });
    f.store(user);
    return user;
  };
  const start = f.session.start("https://app.example/?code=secret&state=state");
  await f.session.invalidate();
  complete();
  await start;
  assert.equal(f.session.getSnapshot().status, "anonymous");
  assert.equal(f.stored(), null);
  assert.equal(await f.session.getAccessToken(), null);
});
