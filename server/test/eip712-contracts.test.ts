import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { toEventSelector, type AbiEvent } from "viem";
import { clearProofTypes, raceResultTypes, runResultTypes, seasonResultTypes } from "../src/eip712.js";
import { loadAbi } from "../src/indexer/abi.js";

/** EIP-712 encodeType for flat structs (no nested struct members). */
function encodeType(types: Record<string, readonly { name: string; type: string }[]>): string {
  const [name, fields] = Object.entries(types)[0];
  return `${name}(${fields.map((f) => `${f.type} ${f.name}`).join(",")})`;
}

const EXPECTED = {
  ClearProof: "ClearProof(address creator,bytes32 layoutHash,uint256 deadline)",
  RunResult: "RunResult(address player,uint256 levelId,uint32 timeMs,bool cleared,uint16 coins,uint256 nonce,uint256 deadline)",
  RaceResult: "RaceResult(bytes32 roomId,address[] ranking)",
  SeasonResult: "SeasonResult(uint256 season,address[] players,address[] creators,uint256[] shares)",
};

const CONTRACTS = resolve(dirname(fileURLToPath(import.meta.url)), "../../contracts/src");
const hasContracts = existsSync(resolve(CONTRACTS, "ForgeCoin.sol")) && existsSync(resolve(CONTRACTS, "LevelNFT.sol"));

describe("EIP-712 types match contracts/", () => {
  it("encodeType strings", () => {
    expect(encodeType(clearProofTypes)).toBe(EXPECTED.ClearProof);
    expect(encodeType(runResultTypes)).toBe(EXPECTED.RunResult);
    expect(encodeType(raceResultTypes)).toBe(EXPECTED.RaceResult);
    expect(encodeType(seasonResultTypes)).toBe(EXPECTED.SeasonResult);
  });

  it.skipIf(!hasContracts)("typehash strings and domain names appear verbatim in the Solidity sources", () => {
    const sol = readFileSync(resolve(CONTRACTS, "LevelNFT.sol"), "utf8") + readFileSync(resolve(CONTRACTS, "ForgeCoin.sol"), "utf8");
    const flat = sol.replace(/"\s*\n\s*"/g, ""); // tolerate split string literals
    for (const s of Object.values(EXPECTED)) expect(flat).toContain(`"${s}"`);
    expect(sol).toContain('"RealmForge LevelNFT"');
    expect(sol).toContain('"RealmForge ForgeCoin"');
  });

  it.skipIf(!hasContracts)("exported event ABIs match event declarations in the Solidity sources", () => {
    const srcs = ["LevelNFT.sol", "ForgeCoin.sol", "interfaces/IForgeCoin.sol"]
      .map((f) => resolve(CONTRACTS, f))
      .filter(existsSync)
      .map((f) => readFileSync(f, "utf8"))
      .join("\n")
      .replace(/\s+/g, " ")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")");
    for (const name of ["LevelNFT", "ForgeCoin"]) {
      for (const ev of loadAbi(name).filter((x): x is AbiEvent => x.type === "event")) {
        // Events not declared in RealmForge sources (Transfer, Approval, RoleGranted, …) are inherited from OpenZeppelin.
        if (!srcs.includes(`event ${ev.name}(`)) continue;
        const params = ev.inputs.map((i) => `${i.type}${i.indexed ? " indexed" : ""} ${i.name}`).join(", ");
        expect(srcs, `${name}.${ev.name}`).toContain(`event ${ev.name}(${params})`);
        expect(toEventSelector(ev)).toMatch(/^0x[0-9a-f]{64}$/);
      }
    }
  });
});
