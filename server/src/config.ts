import { z } from "zod";
import { isAddress, isHex, type Address, type Hex } from "viem";

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const address = z
  .string()
  .refine((v) => isAddress(v), "must be a 0x-prefixed 20-byte address")
  .transform((v) => v as Address);

const optionalAddress = z.preprocess(emptyToUndefined, address.optional());

const privateKey = z
  .string()
  .refine((v) => isHex(v) && v.length === 66, "must be a 0x-prefixed 32-byte hex private key")
  .transform((v) => v as Hex);

const port = z.coerce.number().int().min(0).max(65535);

export const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  RPC_URL: z.url().default("http://127.0.0.1:8545"),
  CHAIN_ID: z.coerce.number().int().positive().default(31337),
  LEVEL_NFT_ADDRESS: optionalAddress,
  FORGE_COIN_ADDRESS: optionalAddress,
  REALM_BADGES_ADDRESS: optionalAddress,
  LEVEL_AUCTION_ADDRESS: optionalAddress,
  INDEXER_START_BLOCK: z.coerce.bigint().nonnegative().default(0n),
  INDEXER_ENABLED: z
    .preprocess(emptyToUndefined, z.enum(["true", "false"]).optional())
    .transform((v) => v !== "false"),
  SIGNER_PRIVATE_KEY: privateKey,
  RELAYER_PRIVATE_KEY: z.preprocess(emptyToUndefined, privateKey.optional()),
  RELAY_DAILY_QUOTA: z.coerce.number().int().positive().max(1000).default(10),
  RELAY_GAS_LIMIT: z.coerce.number().int().positive().max(1_000_000).default(500_000),
  SIGNATURE_TTL_SEC: z.coerce.number().int().positive().default(3600),
  PINATA_JWT: z.preprocess(emptyToUndefined, z.string().optional()),
  IPFS_GATEWAY: z.url().default("https://gateway.pinata.cloud/ipfs/"),
  HOST: z.string().default("0.0.0.0"),
  PORT: port.default(8787),
  GAME_PORT: port.default(2567),
  CORS_ORIGIN: z.string().default("*"),
  DATA_DIR: z.string().default("./data"),
  /** HMAC key for SIWE session tokens (>= 32 chars). Unset = random per process (sessions end on restart). */
  SESSION_SECRET: z.preprocess(emptyToUndefined, z.string().min(32).optional()),
  /** SIWE session token lifetime. Tokens are stateless and cannot be revoked, so keep this short. */
  SESSION_TTL_SEC: z.coerce.number().int().min(60).max(86_400).default(3600),
  /** Comma-separated EIP-4361 domains accepted at /auth/verify (e.g. "realmforge.example"). Empty = any. */
  SIWE_DOMAINS: z.preprocess(emptyToUndefined, z.string().optional()).transform((v) => (v ? v.split(",").map((d) => d.trim()).filter(Boolean) : [])),
  /** Token-bucket limits on signing endpoints (requests per minute). */
  RATE_LIMIT_IP_PER_MIN: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_ADDRESS_PER_MIN: z.coerce.number().int().positive().default(20),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type Config = z.infer<typeof envSchema>;

/**
 * Parse and validate configuration from an env-like object.
 * Throws a readable error listing every invalid variable.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid server configuration:\n${lines.join("\n")}`);
  }
  return parsed.data;
}

/** Load ./.env into process.env if present (Node >= 21.7 built-in, no dotenv dependency). */
export function loadDotEnv(path = ".env"): void {
  try {
    process.loadEnvFile(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
