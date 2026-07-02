import type { ConversionStage } from '../lib/conversion-stage';

const labels: Record<ConversionStage, string> = {
  idle: 'Ready',
  'loading-engine': 'Loading GIS engine…',
  reading: 'Reading input file…',
  converting: 'Converting…',
  packaging: 'Packaging output…',
  done: 'Conversion complete',
  error: 'Conversion failed',
};

interface ConversionProgressProps {
  stage: ConversionStage;
  progress: number;
  message?: string | null;
  error?: string | null;
}

export function ConversionProgress({ stage, progress, message, error }: ConversionProgressProps) {
  if (stage === 'idle') return null;

  const isError = stage === 'error' || Boolean(error);
  const activeIndex = ['loading-engine', 'reading', 'converting', 'packaging', 'done'].indexOf(stage);
  const isDone = stage === 'done';
  const clampedProgress = Math.max(0, Math.min(100, isDone ? 100 : progress));
  const headline = isError
    ? labels.error
    : isDone
      ? labels.done
      : message || labels[stage];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className={`font-medium ${isError ? 'text-red-600' : 'text-slate-800'}`}>
            {headline}
          </p>
          {!isError && <p className="mt-1 text-xs text-slate-500">{clampedProgress}%</p>}
        </div>
        {stage !== 'done' && stage !== 'error' && (
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
        )}
      </div>

      {!isError && (
        <>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-brand-500 transition-all duration-300 ease-out"
              style={{ width: `${clampedProgress}%` }}
            />
          </div>
          <div className="mt-4 grid grid-cols-4 gap-2">
            {['Engine', 'Read', 'Convert', 'Package'].map((label, index) => (
              <div key={label} className="space-y-1">
                <div
                  className={`h-1.5 rounded-full ${index <= activeIndex ? 'bg-brand-500' : 'bg-slate-200'}`}
                />
                <p className="text-xs text-slate-500">{label}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}
