import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAbi, type Abi } from "viem";

/** server/abi (works from src/ via tsx and from dist/ after build). */
export const ABI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../abi");

/**
 * Load an ABI from abi/<name>.json. Accepts:
 *  - a JSON ABI array
 *  - a Hardhat/Foundry artifact `{ abi: [...] }`
 *  - `{ abi: ["event Foo(...)", ...] }` / `["event Foo(...)"]` human-readable signatures
 */
export function loadAbi(name: string, dir = ABI_DIR): Abi {
  const raw = JSON.parse(readFileSync(resolve(dir, `${name}.json`), "utf8")) as unknown;
  const arr = Array.isArray(raw) ? raw : (raw as { abi?: unknown }).abi;
  if (!Array.isArray(arr)) throw new Error(`abi/${name}.json: expected an array or { abi: [...] }`);
  if (arr.every((x) => typeof x === "string")) return parseAbi(arr as string[]) as Abi;
  return arr as Abi;
}
