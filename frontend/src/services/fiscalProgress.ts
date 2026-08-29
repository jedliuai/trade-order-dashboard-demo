export interface FiscalProgressSegments {
  percent: number | null;
  completedLaps: number;
  remainderPercent: number;
  activeLap: number;
}

export interface FiscalSpiralGeometry {
  capacityTurns: number;
  trackPath: string;
  lapSegments: Array<{
    lap: number;
    path: string;
    startTurn: number;
    endTurn: number;
  }>;
  boundaryPoints: Array<{ lap: number; x: number; y: number }>;
  endpoint: { x: number; y: number } | null;
}

export function calculateFiscalProgress(current: number, previous: number): FiscalProgressSegments {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) {
    return { percent: null, completedLaps: 0, remainderPercent: 0, activeLap: 0 };
  }

  const percent = Math.max(0, (current / previous) * 100);
  const completedLaps = Math.floor(percent / 100);
  const remainderPercent = Math.round((percent - completedLaps * 100) * 1e10) / 1e10;

  return {
    percent,
    completedLaps,
    remainderPercent,
    activeLap: remainderPercent > 0 ? completedLaps + 1 : completedLaps
  };
}

function spiralPoint(
  turn: number,
  capacityTurns: number,
  size: number,
  strokeWidth: number
) {
  const center = size / 2;
  const innerRadius = Math.max(7, strokeWidth * 1.35);
  const outerRadius = center - strokeWidth / 2 - 5;
  const radiusGrowth = (outerRadius - innerRadius) / capacityTurns;
  const angle = -Math.PI / 2 + turn * Math.PI * 2;
  const radius = innerRadius + radiusGrowth * turn;
  const angularSpeed = Math.PI * 2;

  return {
    x: center + radius * Math.cos(angle),
    y: center + radius * Math.sin(angle),
    dx: radiusGrowth * Math.cos(angle) - radius * Math.sin(angle) * angularSpeed,
    dy: radiusGrowth * Math.sin(angle) + radius * Math.cos(angle) * angularSpeed
  };
}

function spiralPath(
  startTurn: number,
  endTurn: number,
  capacityTurns: number,
  size: number,
  strokeWidth: number
) {
  const turns = endTurn - startTurn;
  if (turns <= 0) return '';
  const segmentCount = Math.max(8, Math.ceil(turns * 22));
  const segmentTurns = turns / segmentCount;
  const start = spiralPoint(startTurn, capacityTurns, size, strokeWidth);
  const commands = [`M ${start.x.toFixed(2)} ${start.y.toFixed(2)}`];

  for (let index = 0; index < segmentCount; index += 1) {
    const fromTurn = startTurn + index * segmentTurns;
    const toTurn = startTurn + (index + 1) * segmentTurns;
    const from = spiralPoint(fromTurn, capacityTurns, size, strokeWidth);
    const to = spiralPoint(toTurn, capacityTurns, size, strokeWidth);
    const controlScale = segmentTurns / 3;
    commands.push(
      `C ${(from.x + from.dx * controlScale).toFixed(2)} ${(from.y + from.dy * controlScale).toFixed(2)}`,
      `${(to.x - to.dx * controlScale).toFixed(2)} ${(to.y - to.dy * controlScale).toFixed(2)}`,
      `${to.x.toFixed(2)} ${to.y.toFixed(2)}`
    );
  }

  return commands.join(' ');
}

export function buildFiscalSpiralGeometry(
  progress: FiscalProgressSegments,
  size = 78,
  strokeWidth = 6
): FiscalSpiralGeometry {
  const activeTurns = progress.percent === null ? 0 : progress.percent / 100;
  // 始终保留两圈柔和轨迹，让第一圈和“超过 100% 后继续向外”的方向一眼可辨。
  // 超过 200% 后再按实际需要扩展第三圈、第四圈。
  const capacityTurns = Math.max(2, Math.ceil(Math.max(activeTurns, 0.0001) - 1e-10));
  const visibleTurns = Math.min(activeTurns, capacityTurns);
  const endpointPoint = visibleTurns > 0
    ? spiralPoint(visibleTurns, capacityTurns, size, strokeWidth)
    : null;
  const lapSegments = Array.from(
    { length: Math.ceil(visibleTurns - 1e-10) },
    (_, index) => {
      const startTurn = index;
      const endTurn = Math.min(index + 1, visibleTurns);
      return {
        lap: index + 1,
        startTurn,
        endTurn,
        path: spiralPath(startTurn, endTurn, capacityTurns, size, strokeWidth)
      };
    }
  );
  const boundaryPoints = Array.from(
    { length: Math.floor(visibleTurns + 1e-10) },
    (_, index) => {
      const lap = index + 1;
      const point = spiralPoint(lap, capacityTurns, size, strokeWidth);
      return { lap, x: point.x, y: point.y };
    }
  );
  return {
    capacityTurns,
    trackPath: spiralPath(0, capacityTurns, capacityTurns, size, strokeWidth),
    lapSegments,
    boundaryPoints,
    endpoint: endpointPoint ? { x: endpointPoint.x, y: endpointPoint.y } : null
  };
}
