import { useCallback, useEffect, useRef, useState } from 'react';

interface FileDropzoneProps {
  accept: string;
  hint: string;
  maxSizeMb?: number;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}

function getDroppedFiles(event: DragEvent): File[] {
  const list = event.dataTransfer?.files;
  if (list?.length) return Array.from(list);

  const items = event.dataTransfer?.items;
  if (!items) return [];

  const files: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}

export function FileDropzone({
  accept,
  hint,
  maxSizeMb = 30,
  multiple = true,
  onFiles,
  disabled = false,
}: FileDropzoneProps) {
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);

  const validate = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      if (!list.length) return;
      const maxBytes = maxSizeMb * 1024 * 1024;
      const tooLarge = list.find((f) => f.size > maxBytes);
      if (tooLarge) {
        setError(`"${tooLarge.name}" exceeds the ${maxSizeMb} MB limit.`);
        return;
      }
      setError(null);
      onFiles(list);
    },
    [maxSizeMb, onFiles],
  );

  const handleDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      zoneRef.current?.classList.remove('dz-active');
      if (disabled) return;

      const files = getDroppedFiles(event);
      if (files.length) {
        validate(files);
        return;
      }
      setError('No files received from drop. Please use the browse button.');
    },
    [disabled, validate],
  );

  // Single window-level drop handler — no stopPropagation, no zone/window split.
  useEffect(() => {
    const onDragOver = (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };

    window.addEventListener('dragover', onDragOver, false);
    window.addEventListener('drop', handleDrop, false);
    return () => {
      window.removeEventListener('dragover', onDragOver, false);
      window.removeEventListener('drop', handleDrop, false);
    };
  }, [handleDrop]);

  // Visual feedback on the dashed zone only.
  useEffect(() => {
    const zone = zoneRef.current;
    if (!zone) return;

    const setActive = (on: boolean) => zone.classList.toggle('dz-active', on);

    const onDragEnter = (event: DragEvent) => {
      event.preventDefault();
      if (!disabled) setActive(true);
    };
    const onDragOver = (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      if (!disabled) setActive(true);
    };
    const onDragLeave = (event: DragEvent) => {
      event.preventDefault();
      if (zone.contains(event.relatedTarget as Node)) return;
      setActive(false);
    };

    zone.addEventListener('dragenter', onDragEnter);
    zone.addEventListener('dragover', onDragOver);
    zone.addEventListener('dragleave', onDragLeave);

    return () => {
      zone.removeEventListener('dragenter', onDragEnter);
      zone.removeEventListener('dragover', onDragOver);
      zone.removeEventListener('dragleave', onDragLeave);
    };
  }, [disabled]);

  const baseClass =
    'flex min-h-44 flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-8 text-center transition';
  const idleClass = 'border-slate-300 bg-white';
  const disabledClass = 'cursor-not-allowed opacity-60';
  const enabledClass = 'cursor-pointer hover:border-brand-500 hover:bg-brand-50';

  return (
    <div className="space-y-2">
      <style>{`.dz-active{border-color:var(--color-brand-500,#16a34a)!important;background-color:var(--color-brand-50,#f0fdf4)!important}`}</style>
      <div
        ref={zoneRef}
        className={`${baseClass} ${idleClass} ${disabled ? disabledClass : enabledClass}`}
        onClick={() => {
          if (!disabled) inputRef.current?.click();
        }}
      >
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          onChange={(e) => {
            if (e.target.files?.length) validate(e.target.files);
          }}
        />
        <p className="text-base font-medium text-slate-800">Drop files here</p>
        <p className="mt-2 text-sm text-slate-500">{hint}</p>
        <p className="mt-1 text-xs text-slate-400">Or drop anywhere on this page</p>
        <span className="pointer-events-none mt-4 inline-block rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm">
          Or click to browse files
        </span>
        <p className="mt-3 text-xs text-slate-400">Max {maxSizeMb} MB · processed locally in your browser</p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
