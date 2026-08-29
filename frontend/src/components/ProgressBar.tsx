import React from 'react';
import { Check, AlertCircle, AlertTriangle, Play } from 'lucide-react';

export interface StepNode {
  label: string;
  date?: string;
  status: 'completed' | 'active' | 'pending' | 'warning' | 'danger';
  desc?: string;
  highlight?: boolean;
}

interface ProgressBarProps {
  steps: StepNode[];
  compact?: boolean;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ steps, compact = false }) => {
  return (
    <div className={`w-full ${compact ? 'px-2 pb-4 pt-10' : 'px-4 pb-6 pt-12'}`}>
      <div className="relative flex items-center justify-between w-full">
        {/* Connecting Background Line */}
        <div className="absolute left-0 right-0 top-1/2 z-0 h-0.5 -translate-y-1/2 bg-border-strong/30" />

        {/* Connecting Progress Line */}
        <div
          className="absolute left-0 top-1/2 z-0 h-0.5 -translate-y-1/2 bg-gradient-to-r from-brand-emerald via-brand-cyan to-border-strong/30 transition-all duration-500"
          style={{
            width: `${Math.max(0, (steps.filter(s => s.status === 'completed').length - 1) / (steps.length - 1)) * 100}%`
          }}
        />

        {/* Nodes */}
        {steps.map((step, idx) => {
          // Determine status-specific styling
          let circleBg = 'border-border-strong bg-surface-muted text-subtle';
          let textColor = 'text-subtle';
          let icon = null;

          if (step.status === 'completed') {
            circleBg = step.highlight
              ? 'bg-brand-cyan border-brand-cyan text-white shadow shadow-brand-cyan/25'
              : 'bg-brand-emerald border-brand-emerald text-white shadow shadow-emerald-600/15';
            textColor = step.highlight ? 'text-brand-cyan font-bold' : 'text-brand-emerald font-semibold';
            icon = <Check className="w-4 h-4 text-white-force" />;
          } else if (step.status === 'active') {
            circleBg = 'bg-brand-cyan/20 border-brand-cyan text-brand-cyan shadow shadow-cyan-500/10 ring-4 ring-cyan-500/10 animate-pulse';
            textColor = 'text-brand-cyan font-bold';
            icon = <Play className="w-3.5 h-3.5 fill-brand-cyan" />;
          } else if (step.status === 'warning') {
            circleBg = 'bg-brand-amber/20 border-brand-amber text-brand-amber shadow shadow-amber-500/10 animate-pulse';
            textColor = 'text-brand-amber font-semibold';
            icon = <AlertTriangle className="w-4 h-4" />;
          } else if (step.status === 'danger') {
            circleBg = 'bg-brand-rose/20 border-brand-rose text-brand-rose shadow shadow-rose-500/10 animate-pulse';
            textColor = 'text-brand-rose font-semibold';
            icon = <AlertCircle className="w-4 h-4" />;
          } else {
            // Pending
            circleBg = 'border-border-strong/70 bg-surface-muted text-subtle';
            textColor = 'text-muted font-medium';
            icon = <span className="text-[10px] font-bold">{idx + 1}</span>;
          }

          return (
            <div key={idx} className="relative flex flex-col items-center z-10 flex-1">
              {/* Date is the fastest-scanned detail, so keep it above the node and visually stronger. */}
              {step.date && (
                <span className={`absolute whitespace-nowrap rounded-md border border-border bg-surface px-2 py-0.5 font-semibold text-body shadow-sm ${compact ? 'bottom-9 text-[11px]' : 'bottom-10 text-xs'} ${
                  step.highlight ? 'border-brand-cyan/30 bg-brand-cyan/10 text-brand-cyan' : ''
                }`}>
                  {step.date}
                </span>
              )}

              {/* Circular Indicator */}
              <div className={`${compact ? (step.highlight ? 'h-8 w-8 -mt-0.5' : 'h-7 w-7') : (step.highlight ? 'w-9 h-9 -mt-0.5' : 'w-8 h-8')} rounded-full flex items-center justify-center border-2 transition-all duration-300 ${circleBg}`}>
                {icon}
              </div>

              {/* Node Title & Detail */}
              <div className={`absolute flex flex-col items-center text-center ${compact ? 'top-9 w-24' : 'top-10 w-32'}`}>
                <span className={`${compact ? 'text-[10px]' : 'text-[11px]'} select-none tracking-tight ${textColor}`}>
                  {step.label}
                </span>

                {!step.date && step.desc ? (
                  <span className="mt-1 text-[10px] italic text-subtle">
                    {step.desc}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {/* Spacer to prevent overlap of absolute step description labels */}
      <div className={compact ? 'h-10' : 'h-12'} />
    </div>
  );
};
