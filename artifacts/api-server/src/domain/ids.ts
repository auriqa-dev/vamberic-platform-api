import { randomBytes } from "node:crypto";

/**
 * Application IDs are owned by the Platform API.  The suffix is a lowercase
 * Crockford ULID (26 characters), which keeps IDs sortable without exposing
 * Mongo's internal `_id`.
 */
export const PLATFORM_ID_PREFIXES = [
  "product",
  "person",
  "contact",
  "org",
  "orgrel",
  "prodrel",
  "permission",
  "opportunity",
  "subscription",
  "entitlement",
  "campaign",
  "import",
  "event",
  "transaction",
] as const;

export type PlatformIdPrefix = (typeof PLATFORM_ID_PREFIXES)[number];

const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";
const ULID_PATTERN = /^[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$/;
const prefixSet = new Set<string>(PLATFORM_ID_PREFIXES);

function encodeTime(time: number): string {
  let value = time;
  let encoded = "";
  for (let index = 0; index < 10; index += 1) {
    encoded = CROCKFORD[value % 32] + encoded;
    value = Math.floor(value / 32);
  }
  return encoded;
}

function encodeRandom(random: Uint8Array): string {
  let value = 0n;
  for (const byte of random) value = (value << 8n) | BigInt(byte);

  let encoded = "";
  for (let index = 0; index < 16; index += 1) {
    encoded = CROCKFORD[Number(value & 31n)] + encoded;
    value >>= 5n;
  }
  return encoded;
}

export function generateUlid(now = Date.now()): string {
  if (!Number.isSafeInteger(now) || now < 0 || now >= 2 ** 48) {
    throw new RangeError(
      "ULID timestamp must be a non-negative 48-bit integer",
    );
  }
  return `${encodeTime(now)}${encodeRandom(randomBytes(10))}`;
}

export function generatePlatformId(prefix: PlatformIdPrefix): string {
  return `${prefix}_${generateUlid()}`;
}

/** Descriptive alias for API consumers. */
export const generateApplicationId = generatePlatformId;

export function isPlatformId(
  value: unknown,
  prefix?: PlatformIdPrefix,
): value is string {
  if (typeof value !== "string") return false;
  const separator = value.indexOf("_");
  if (separator < 1) return false;
  const actualPrefix = value.slice(0, separator);
  if (!prefixSet.has(actualPrefix)) return false;
  if (prefix && actualPrefix !== prefix) return false;
  return ULID_PATTERN.test(value.slice(separator + 1));
}

export const isValidPlatformId = isPlatformId;

export function platformIdPattern(prefix: PlatformIdPrefix): RegExp {
  return new RegExp(`^${prefix}_[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$`);
}
