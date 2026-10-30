import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface PinResult {
  cid: string;
  /** "pinata" or "local" (dev fallback, not announced to the IPFS network). */
  provider: "pinata" | "local";
}

export interface Pinner {
  readonly provider: "pinata" | "local";
  pin(bytes: Uint8Array, name: string, contentType: string): Promise<PinResult>;
}

const B32 = "abcdefghijklmnopqrstuvwxyz234567";

function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/**
 * CIDv1 (codec `raw` 0x55, multihash sha2-256) in base32 — what IPFS assigns to a
 * single-block file added with `--cid-version=1 --raw-leaves` (files <= 256 KiB).
 * Used to give locally stored dev files a realistic, content-addressed id.
 */
export function rawCidV1(bytes: Uint8Array): string {
  const digest = createHash("sha256").update(bytes).digest();
  return "b" + base32(Uint8Array.from([0x01, 0x55, 0x12, 0x20, ...digest]));
}

const CID_RE = /^[a-zA-Z0-9]{20,100}$/;

export class LocalPinner implements Pinner {
  readonly provider = "local" as const;
  constructor(private readonly dir: string) {}

  async pin(bytes: Uint8Array): Promise<PinResult> {
    const cid = rawCidV1(bytes);
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, cid), bytes);
    return { cid, provider: this.provider };
  }

  async get(cid: string): Promise<Buffer | null> {
    if (!CID_RE.test(cid)) return null;
    try {
      return await readFile(join(this.dir, cid));
    } catch {
      return null;
    }
  }
}

/** Pinata `pinFileToIPFS` — pins the exact bytes (so keccak256(bytes) == layoutHash). */
export class PinataPinner implements Pinner {
  readonly provider = "pinata" as const;
  constructor(
    private readonly jwt: string,
    private readonly endpoint = "https://api.pinata.cloud/pinning/pinFileToIPFS",
  ) {}

  async pin(bytes: Uint8Array, name: string, contentType: string): Promise<PinResult> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: contentType }), name);
    form.append("pinataMetadata", JSON.stringify({ name }));
    form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.jwt}` },
      body: form,
    });
    if (!res.ok) throw new Error(`Pinata pin failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { IpfsHash?: string };
    if (!body.IpfsHash) throw new Error("Pinata response missing IpfsHash");
    return { cid: body.IpfsHash, provider: this.provider };
  }
}
