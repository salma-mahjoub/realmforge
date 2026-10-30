/**
 * Run-length encoding for the uint8 terrain grid (SPEC §3.4 `layers.terrain`).
 *
 * Format: comma-separated runs `value*count`; a run of length 1 is written as just `value`.
 * Example: [0,0,0,1,1,2] -> "0*3,1*2,2". Human-diffable, deterministic, compact for
 * mostly-empty grids, and stable for hashing.
 */
export function encodeRle(grid: ArrayLike<number>): string {
    const out: string[] = [];
    let i = 0;
    while (i < grid.length) {
        const v = grid[i];
        let n = 1;
        while (i + n < grid.length && grid[i + n] === v) n++;
        out.push(n === 1 ? `${v}` : `${v}*${n}`);
        i += n;
    }
    return out.join(',');
}

export function decodeRle(data: string, expectedLength: number): Uint8Array {
    const grid = new Uint8Array(expectedLength);
    if (!data) return grid;
    let p = 0;
    for (const run of data.split(',')) {
        const [vs, ns] = run.split('*');
        const v = Number(vs);
        const n = ns === undefined ? 1 : Number(ns);
        if (!Number.isInteger(v) || v < 0 || v > 255 || !Number.isInteger(n) || n < 1) {
            throw new Error(`Invalid RLE run "${run}"`);
        }
        if (p + n > expectedLength) throw new Error('RLE data longer than grid');
        grid.fill(v, p, p + n);
        p += n;
    }
    if (p !== expectedLength) throw new Error(`RLE data length ${p} != expected ${expectedLength}`);
    return grid;
}
