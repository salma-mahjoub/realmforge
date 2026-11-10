import type { TraceSample } from './run';

/** Linear, frame-based playback of the validated run trace. Returns null outside its recorded span. */
export function sampleGhostTrace(trace: readonly TraceSample[], frame: number): TraceSample | null {
    if (!trace.length || frame < trace[0]!.f || frame > trace[trace.length - 1]!.f) return null;
    let lo = 0;
    let hi = trace.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (trace[mid]!.f < frame) lo = mid + 1;
        else hi = mid;
    }
    const b = trace[lo]!;
    if (b.f === frame || lo === 0) return { f: frame, x: b.x, y: b.y };
    const a = trace[lo - 1]!;
    const t = (frame - a.f) / (b.f - a.f);
    return { f: frame, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
