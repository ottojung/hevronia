export interface ProgressObservation {
  elapsed: number;
  rounds: number;
}

export interface RegressionFit {
  /** Projected elapsed milliseconds at which completed rounds reach the total. */
  finishTime: number;
}

/**
 * Fits completed rounds as a least-squares linear function of elapsed time and
 * derives the projected finish time for the given total rounds. With a single
 * observation the fit degenerates to a line through the origin; with zero
 * usable points or a non-positive slope the ETA is indeterminate.
 */
export function fitProgressRegression(
  points: readonly ProgressObservation[],
  totalRounds: number,
): RegressionFit | undefined {
  const count = points.length;
  if (count === 0) return undefined;
  if (count === 1) {
    const single = points[0];
    if (single === undefined || single.elapsed <= 0 || single.rounds <= 0) return undefined;
    return { finishTime: totalRounds / (single.rounds / single.elapsed) };
  }
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (const { elapsed, rounds } of points) {
    sumX += elapsed;
    sumY += rounds;
    sumXY += elapsed * rounds;
    sumXX += elapsed * elapsed;
  }
  const denominator = count * sumXX - sumX * sumX;
  if (denominator <= 0) return undefined;
  const slope = (count * sumXY - sumX * sumY) / denominator;
  if (slope <= 0) return undefined;
  const intercept = (sumY - slope * sumX) / count;
  return { finishTime: (totalRounds - intercept) / slope };
}
