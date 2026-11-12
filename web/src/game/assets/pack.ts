/**
 * The game draws everything from a manifest-driven asset pack (`/assets/manifest.json`, schema 1).
 * The repository ships one pack: the CC0 Kenney set documented in `assets/CREDITS.md`.
 * Another pack can be dropped in by serving a manifest of the same schema at another URL.
 */
export type AssetPack = 'kenney';

export function selectedPack(): AssetPack {
    return 'kenney';
}

export function manifestUrl(_pack: AssetPack = 'kenney'): string {
    return '/assets/manifest.json';
}

/** Validate before handing data to Phaser: Vite returns HTML for missing public files. */
export async function fetchPackManifest(pack: AssetPack = 'kenney', fetcher: typeof fetch = fetch): Promise<{ manifest: unknown; pack: AssetPack }> {
    const response = await fetcher(manifestUrl(pack), { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const manifest = await response.json();
    if (manifest?.schema !== 1 || !manifest.elements) throw new Error('Invalid asset manifest');
    return { manifest, pack };
}
