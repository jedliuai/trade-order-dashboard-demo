import React, { useId } from 'react';
import { buildFiscalSpiralGeometry, calculateFiscalProgress } from '../services/fiscalProgress';

interface FiscalProgressRingProps {
  current: number;
  previous: number;
  color: string;
  size?: number;
  strokeWidth?: number;
}

const RING_PALETTES: Record<string, [string, string]> = {
  '#ad8557': ['#FFD86A', '#FF932E'],
  '#5d8768': ['#67E6B0', '#1CBA78'],
  '#a8624d': ['#FF9A70', '#FF5144'],
  '#a17b30': ['#FFE873', '#FFB817']
};

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
  const [startColor, endColor] = RING_PALETTES[color] || [color, color];
  const displayPercent = progress.percent === null ? '—' : `${progress.percent.toFixed(1)}%`;
  const lapDescription = progress.percent === null
    ? '上财年无可比基数'
    : progress.percent > 100
      ? `第 ${progress.activeLap} 圈 · ${(progress.remainderPercent || 100).toFixed(1)}%`
      : '占上财年累计';

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
          <linearGradient id={`${idBase}-progress`} x1="8%" y1="8%" x2="92%" y2="92%">
            <stop offset="0%" stopColor={startColor} />
            <stop offset="100%" stopColor={endColor} />
          </linearGradient>
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
        {geometry.progressPath && (
          <path d={geometry.progressPath} fill="none" stroke={`url(#${idBase}-progress)`}
            strokeWidth={strokeWidth} strokeLinecap="round" filter={`url(#${idBase}-depth)`} />
        )}
        {geometry.endpoint && (
          <circle
            cx={geometry.endpoint.x}
            cy={geometry.endpoint.y}
            r={strokeWidth / 2 - 1}
            fill={endColor}
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
