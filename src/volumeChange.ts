/**
 * The volume, in percent, a volume tool's arguments ask for: `change` points from `current`, or
 * `volume`. The delegate fills in both, with 0 for the one it doesn't mean.
 */
export function targetPercent(
  current: number,
  { volume, change }: { volume?: number; change?: number }
): number {
  return change ? current + change : (volume ?? current)
}
