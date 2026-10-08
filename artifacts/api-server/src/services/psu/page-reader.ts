// Extracted from the existing PSU page reader; legacy Agent implementation remains historical.
import { abortable } from "./abort";
import { z } from "zod4";
const ipv4 = z.ipv4(),
  ipv6 = z.ipv6();
const isIP = (value: string) =>
  ipv4.safeParse(value).success ? 4 : ipv6.safeParse(value).success ? 6 : 0;
import { digest } from "@workspace/agent-runtime-protocol";

export const WEBSITE_LIMITS = Object.freeze({
  pages: 6,
  concurrency: 2,
  redirects: 2,
  decodedBytes: 1_048_576,
  textBytes: 16_384,
  totalTextBytes: 49_152,
  pageMs: 10_000,
  totalMs: 60_000,
  depth: 1,
});
function origin(value: string) {
  const u = new URL(value);
  if (
    u.protocol !== "https:" ||
    u.port ||
    u.username ||
    u.password ||
    u.pathname !== "/" ||
    u.search ||
    u.hash ||
    isIP(u.hostname) ||
    !u.hostname.includes(".") ||
    u.hostname.endsWith(".") ||
    /(?:^|\.)(localhost|local|internal|invalid|test)$/.test(u.hostname)
  )
    throw new Error("Website origin denied");
  return u.origin;
}
export const WebsitePolicySchema = z.strictObject({
  enabled: z.boolean(),
  origins: z
    .array(
      z.string().refine((v) => {
        try {
          return origin(v) === v;
        } catch {
          return false;
        }
      }),
    )
    .max(4),
});
export const WebsiteRequestSchema = z.strictObject({
  urls: z.array(z.string().max(2048)).min(1).max(6),
});
export const WebsitePageSchema = z.strictObject({
  url: z.string().max(2048),
  title: z.string().max(200),
  text: z.string().max(16384),
  retrievedAt: z.iso.datetime(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});
/** A conservative public-address policy. IPv6 transition/special allocations
 * are denied rather than guessing an embedded IPv4 destination. */
export function requirePublicAddress(address: string): string {
  const kind = isIP(address);
  if (kind === 4) {
    const [a, b, c] = address.split(".").map(Number) as [
      number,
      number,
      number,
      number,
    ];
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 &&
        (b === 168 || b === 0 || b === 2 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    )
      throw new Error("Non-public destination");
  } else if (kind === 6) {
    const first = parseInt(address.split(":")[0]!, 16);
    if (
      !Number.isInteger(first) ||
      first < 0x2000 ||
      first > 0x3fff ||
      first === 0x2001 ||
      first === 0x2002 ||
      first === 0x3fff ||
      address.includes(".")
    )
      throw new Error("Non-public destination");
  } else throw new Error("Invalid destination");
  return address;
}
/** Bound once by trusted composition after ClaimedWork validation. Request or
 * checkpoint data cannot replace this closure's immutable authority. */
export function bindWebsitePolicy(value: unknown) {
  const policy = WebsitePolicySchema.parse(value);
  const allowed = new Set(policy.origins);
  return Object.freeze({
    requireUrl(value: string) {
      if (!policy.enabled) throw new Error("Website retrieval disabled");
      const u = new URL(value);
      if (
        u.protocol !== "https:" ||
        u.username ||
        u.password ||
        u.port ||
        u.search ||
        u.hash ||
        isIP(u.hostname) ||
        !allowed.has(u.origin)
      )
        throw new Error("Website URL denied");
      return u.href;
    },
    requireAddresses(addresses: readonly string[]) {
      if (!addresses.length) throw new Error("DNS unavailable");
      return addresses.map(requirePublicAddress);
    },
    fingerprint: digest(policy),
  });
}
/** Transport implementations must pin this IP while checking TLS servername;
 * no fetch/redirect/proxy/cookie defaults. A real transport is not configured. */
export interface WebsiteTransport {
  resolve(hostname: string, signal: AbortSignal): Promise<string[]>;
  read(request: {
    url: string;
    address: string;
    servername: string;
    signal: AbortSignal;
    maximumDecodedBytes: number;
    timeoutMs: number;
  }): Promise<{
    access: "allowed" | "denied" | "unknown";
    redirect?: string;
    decodedBytes: number;
    text: string;
    title: string;
  }>;
}
export function createBoundedWebsiteReader(
  policyValue: unknown,
  transport: WebsiteTransport,
  now = () => Date.now(),
) {
  const bound = bindWebsitePolicy(policyValue);
  return createWebsiteReader(
    {
      requireInitialUrl: bound.requireUrl,
      requireRedirectUrl: bound.requireUrl,
      requireAddresses: bound.requireAddresses,
    },
    transport,
    now,
  );
}
/** Shared bounded reader; policies are supplied by trusted composition only. */
export function createWebsiteReader(
  policy: {
    requireInitialUrl(value: string): string;
    requireRedirectUrl(value: string): string;
    requireAddresses(addresses: readonly string[]): string[];
  },
  transport: WebsiteTransport,
  now = () => Date.now(),
) {
  let pages = 0,
    totalBytes = 0,
    active = 0;
  const seen = new Set<string>();
  const started = now();
  return async (input: unknown, signal: AbortSignal) => {
    const request = WebsiteRequestSchema.parse(input);
    const result = [];
    for (const value of request.urls) {
      signal.throwIfAborted();
      if (
        active >= WEBSITE_LIMITS.concurrency ||
        pages >= WEBSITE_LIMITS.pages ||
        now() - started >= WEBSITE_LIMITS.totalMs
      )
        throw new Error("Website budget exhausted");
      let url = policy.requireInitialUrl(value);
      if (seen.has(url)) continue;
      pages++;
      active++;
      try {
        const pageStarted = now();
        for (let redirects = 0; ; redirects++) {
          signal.throwIfAborted();
          if (
            now() - pageStarted >= WEBSITE_LIMITS.pageMs ||
            now() - started >= WEBSITE_LIMITS.totalMs
          )
            throw new Error("Website timeout");
          const u = new URL(url);
          const boundedSignal = AbortSignal.any([
            signal,
            AbortSignal.timeout(
              Math.max(
                1,
                Math.min(
                  WEBSITE_LIMITS.pageMs - (now() - pageStarted),
                  WEBSITE_LIMITS.totalMs - (now() - started),
                ),
              ),
            ),
          ]);
          const addresses = policy.requireAddresses(
            await abortable(
              () => transport.resolve(u.hostname, boundedSignal),
              boundedSignal,
            ),
          );
          const response = await abortable(
            () =>
              transport.read({
                url,
                address: addresses[0]!,
                servername: u.hostname,
                signal: boundedSignal,
                maximumDecodedBytes: WEBSITE_LIMITS.decodedBytes,
                timeoutMs: WEBSITE_LIMITS.pageMs,
              }),
            boundedSignal,
          );
          signal.throwIfAborted();
          if (response.access !== "allowed")
            throw new Error("Website access policy denied or unavailable");
          if (
            !Number.isSafeInteger(response.decodedBytes) ||
            response.decodedBytes > WEBSITE_LIMITS.decodedBytes ||
            response.decodedBytes < 0
          )
            throw new Error("Decoded response limit");
          if (response.redirect) {
            if (redirects >= WEBSITE_LIMITS.redirects)
              throw new Error("Redirect limit");
            url = policy.requireRedirectUrl(
              new URL(response.redirect, url).href,
            );
            continue;
          }
          const bytes = Buffer.byteLength(response.text, "utf8");
          totalBytes += bytes;
          if (
            bytes > WEBSITE_LIMITS.textBytes ||
            totalBytes > WEBSITE_LIMITS.totalTextBytes
          )
            throw new Error("Website text limit");
          if (
            now() - pageStarted >= WEBSITE_LIMITS.pageMs ||
            now() - started >= WEBSITE_LIMITS.totalMs
          )
            throw new Error("Website timeout");
          seen.add(url);
          result.push(
            WebsitePageSchema.parse({
              url,
              title: response.title,
              text: response.text,
              retrievedAt: new Date(now()).toISOString(),
              digest: digest(response.text),
            }),
          );
          break;
        }
      } finally {
        active--;
      }
    }
    return result;
  };
}
