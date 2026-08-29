import React, { useId } from 'react';
import { buildFiscalSpiralGeometry, calculateFiscalProgress } from '../services/fiscalProgress';

interface FiscalProgressRingProps {
  current: number;
  previous: number;
  color: string;
  size?: number;
  strokeWidth?: number;
}

const LAP_PALETTES: Record<string, Array<[string, string]>> = {
  '#ad8557': [['#FFD86A', '#FF932E'], ['#C8FA45', '#54D873'], ['#FF6AA6', '#FF3B5C'], ['#A884FF', '#6E5EF7']],
  '#5d8768': [['#67E6B0', '#1CBA78'], ['#57E3FF', '#159BE8'], ['#C48AFF', '#7B56EE'], ['#FFD566', '#FF9D32']],
  '#a8624d': [['#FF9A70', '#FF5144'], ['#FF5DA7', '#E92770'], ['#FFD45A', '#FF8C24'], ['#86E85F', '#29BE72']],
  '#a17b30': [['#FFE873', '#FFB817'], ['#C8F544', '#50CC68'], ['#49E1F0', '#159DD0'], ['#B88BFF', '#7658E9']]
};

function getLapPalette(baseColor: string, lap: number): [string, string] {
  const palettes = LAP_PALETTES[baseColor.toLowerCase()] || [
    [baseColor, '#FFB347'],
    ['#C8F544', '#50CC68'],
    ['#49E1F0', '#159DD0'],
    ['#FF5DA7', '#E92770']
  ];
  return palettes[(lap - 1) % palettes.length];
}

export const FiscalProgressRing: React.FC<FiscalProgressRingProps> = ({
  current,
  previous,
  color,
  size = 112,
  strokeWidth = 10
}) => {
  const idBase = `fiscal-spiral-${useId().replace(/:/g, '')}`;
  const progress = calculateFiscalProgress(current, previous);
  const geometry = buildFiscalSpiralGeometry(progress, size, strokeWidth);
  const displayPercent = progress.percent === null ? '—' : `${progress.percent.toFixed(1)}%`;
  const lapDescription = progress.percent === null
    ? '上财年无可比基数'
    : progress.completedLaps === 0
      ? `第 1 圈已完成 ${progress.remainderPercent.toFixed(1)}%`
      : progress.remainderPercent > 0
        ? `已完成 ${progress.completedLaps} 圈 · 第 ${progress.activeLap} 圈 ${progress.remainderPercent.toFixed(1)}%`
        : `已完整完成 ${progress.completedLaps} 圈`;

  return (
    <div data-testid="fiscal-progress-ring" className="flex shrink-0 flex-col items-center" aria-label={`本财年进度：${displayPercent}，${lapDescription}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="overflow-visible">
        <defs>
          <radialGradient id={`${idBase}-surface`} cx="42%" cy="34%" r="70%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="72%" stopColor={color} stopOpacity="0.045" />
            <stop offset="100%" stopColor={color} stopOpacity="0.11" />
          </radialGradient>
          <filter id={`${idBase}-depth`} x="-30%" y="-30%" width="160%" height="170%">
            <feDropShadow dx="0" dy="2.5" stdDeviation="2.2" floodColor="#172033" floodOpacity="0.26" />
            <feDropShadow dx="0" dy="0" stdDeviation="1.1" floodColor={color} floodOpacity="0.18" />
          </filter>
          {geometry.lapSegments.map((segment) => {
            const [startColor, endColor] = getLapPalette(color, segment.lap);
            return (
              <linearGradient key={segment.lap} id={`${idBase}-lap-${segment.lap}`} x1="8%" y1="8%" x2="92%" y2="92%">
                <stop offset="0%" stopColor={startColor} />
                <stop offset="82%" stopColor={endColor} />
                <stop offset="100%" stopColor={endColor} />
              </linearGradient>
            );
          })}
        </defs>
          <circle cx={size / 2} cy={size / 2} r={size / 2 - 1} fill={`url(#${idBase}-surface)`} />
          <path
            d={geometry.trackPath}
            fill="none"
            stroke="#223047"
            strokeOpacity="0.09"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {geometry.lapSegments.map((segment) => (
            <React.Fragment key={segment.lap}>
              <path
                d={segment.path}
                fill="none"
                stroke="#101827"
                strokeOpacity="0.18"
                strokeWidth={strokeWidth + 3}
                strokeLinecap="round"
                strokeLinejoin="round"
                transform="translate(0 1.5)"
              />
            <path
              d={segment.path}
              fill="none"
              stroke={`url(#${idBase}-lap-${segment.lap})`}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              filter={`url(#${idBase}-depth)`}
            />
            </React.Fragment>
          ))}
          {geometry.boundaryPoints.map((point) => (
            <circle
              key={point.lap}
              cx={point.x}
              cy={point.y}
              r={Math.max(1.4, strokeWidth * 0.16)}
              fill="#fffefb"
              opacity="0.94"
            />
          ))}
          {geometry.endpoint && (
            <circle
              cx={geometry.endpoint.x}
              cy={geometry.endpoint.y}
              r={strokeWidth / 2 - 1}
              fill={getLapPalette(color, Math.max(1, progress.activeLap))[1]}
              stroke="#fffefb"
              strokeWidth="1.6"
            />
          )}
      </svg>
      <strong className="-mt-1 rounded-full border border-white/80 bg-white/95 px-3 py-1 text-[12px] font-extrabold leading-none shadow-[0_3px_10px_rgba(20,28,45,0.12)]" style={{ color }}>{displayPercent}</strong>
      <span className="mt-1.5 max-w-36 text-center text-[9px] font-semibold leading-3.5 text-subtle">{lapDescription}</span>
    </div>
  );
};
