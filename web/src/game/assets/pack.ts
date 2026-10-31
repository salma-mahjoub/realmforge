export type AssetPack = 'mario' | 'kenney';
export const PACK_STORAGE_KEY = 'realmforge:asset-pack';

export function selectedPack(): AssetPack {
    try {
        const saved = localStorage.getItem(PACK_STORAGE_KEY);
        if (saved === 'kenney' || saved === 'mario') return saved;
    } catch { /* Storage can be disabled in private browser contexts. */ }
    return import.meta.env.VITE_ASSET_PACK === 'kenney' ? 'kenney' : 'mario';
}

export function manifestUrl(pack: AssetPack): string {
    return pack === 'mario' ? '/packs/mario/manifest.json' : '/assets/manifest.json';
}

/** Validate before handing data to Phaser: Vite returns HTML for missing public files. */
export async function fetchPackManifest(pack: AssetPack, fetcher: typeof fetch = fetch): Promise<{ manifest: unknown; pack: AssetPack }> {
    try {
        const response = await fetcher(manifestUrl(pack), { signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const manifest = await response.json();
        if (manifest?.schema !== 1 || !manifest.elements) throw new Error('Invalid asset manifest');
        return { manifest, pack };
    } catch (error) {
        if (pack === 'kenney') throw error;
        console.info('[Preloader] Mario pack unavailable; loading Kenney');
        return fetchPackManifest('kenney', fetcher);
    }
}
