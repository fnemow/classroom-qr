// Values are relative to the latest HLS playlist, not the classroom camera clock.
export function liveSeekTarget(live: boolean, current: number, target: number | null,
  latency: number, force = false): number | undefined {
  if (!live || target === null || !Number.isFinite(target) || target < 0) return;
  if (target - current > 0.25 && (force || latency > 4 || target - current > 2)) return target;
}
