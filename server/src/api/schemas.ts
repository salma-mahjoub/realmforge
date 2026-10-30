import { z } from "zod";
import { isAddress, isHex, type Address, type Hex } from "viem";
import { runSubmissionSchema } from "../validation/types.js";

export const addressSchema = z
  .string()
  .refine((v) => isAddress(v), "invalid address")
  .transform((v) => v as Address);

export const bytes32Schema = z
  .string()
  .refine((v) => isHex(v) && v.length === 66, "expected 0x-prefixed bytes32")
  .transform((v) => v.toLowerCase() as Hex);

export const uintString = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform((v) => BigInt(v));

export const pinBodySchema = z.strictObject({
  /** Level JSON (SPEC §3.4) — validated separately to return precise errors. */
  level: z.unknown(),
  /** Optional PNG/JPEG/WebP thumbnail as a data URL or bare base64. */
  thumbnail: z.string().max(3_000_000).optional(),
  description: z.string().max(1000).optional(),
});

export const clearProofBodySchema = z.strictObject({
  creator: addressSchema,
  layoutHash: bytes32Schema,
  run: runSubmissionSchema,
});

export const runValidateBodySchema = z.strictObject({
  player: addressSchema,
  levelId: uintString,
  run: runSubmissionSchema,
});

export const listQuerySchema = z.object({
  sort: z.enum(["new", "popular", "hardest", "liked"]).default("new"),
  creator: addressSchema.optional(),
  owner: addressSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  offset: z.coerce.number().int().min(0).default(0),
});

export const idParamSchema = z.object({ id: z.coerce.number().int().nonnegative() });
