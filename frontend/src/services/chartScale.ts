export interface NiceChartScale {
  domainMax: number;
  step: number;
  ticks: number[];
}

function niceStep(value: number) {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const factor = normalized <= 1
    ? 1
    : normalized <= 2
      ? 2
      : normalized <= 2.5
        ? 2.5
        : normalized <= 5
          ? 5
          : 10;
  return Math.max(1, factor * magnitude);
}

export function createNiceChartScale(values: number[], targetIntervals = 5): NiceChartScale {
  const maximum = Math.max(0, ...values.filter(Number.isFinite));
  if (maximum === 0) {
    return { domainMax: 104, step: 20, ticks: [0, 20, 40, 60, 80, 100] };
  }

  const step = niceStep(maximum / Math.max(2, targetIntervals));
  const topTick = Math.ceil(maximum / step) * step;
  const tickCount = Math.round(topTick / step);
  const ticks = Array.from({ length: tickCount + 1 }, (_, index) => index * step);

  return {
    domainMax: topTick + step * 0.12,
    step,
    ticks
  };
}
