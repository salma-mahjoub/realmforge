export interface RankablePlayer {
  address: string;
  disqualified: boolean;
  /** Index of the last checkpoint reached (-1 = none). */
  checkpoint: number;
  x: number;
  y: number;
}

/**
 * Full ranking of a race for ForgeCoin.settleRace, which needs at least two ranked players.
 * Finishers come first, in finish order. Everyone else (died and gave up, timed out, left) is ranked
 * by progress: not disqualified before disqualified, then the furthest checkpoint, then the shortest
 * distance to the goal (or the furthest x when the level is unknown), then address for a stable order.
 */
export function completeRanking(finishOrder: readonly string[], players: Iterable<RankablePlayer>, goal?: { x: number; y: number }): string[] {
  const finished = new Set(finishOrder);
  const distance = (p: RankablePlayer) => (goal ? Math.hypot(goal.x - p.x, goal.y - p.y) : -p.x);
  const rest = [...players]
    .filter((p) => !finished.has(p.address))
    .sort(
      (a, b) =>
        Number(a.disqualified) - Number(b.disqualified) ||
        b.checkpoint - a.checkpoint ||
        distance(a) - distance(b) ||
        a.address.localeCompare(b.address),
    );
  return [...finishOrder, ...rest.map((p) => p.address)];
}
