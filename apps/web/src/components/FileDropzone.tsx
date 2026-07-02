import { useCallback, useEffect, useId, useRef, useState } from 'react';

interface FileDropzoneProps {
  accept: string;
  hint: string;
  maxSizeMb?: number;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}

declare global {
  interface Window {
    __geofiletoolsPendingFiles?: File[];
  }
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
  const zoneRef = useRef<HTMLLabelElement>(null);
  const inputId = useId();

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

  const consumePendingFiles = useCallback(() => {
    const pending = window.__geofiletoolsPendingFiles;
    if (!pending?.length || disabled) return;
    delete window.__geofiletoolsPendingFiles;
    validate(pending);
  }, [disabled, validate]);

  const handleDroppedFiles = useCallback(
    (event: Event) => {
      if (disabled) return;
      const custom = event as CustomEvent<File[]>;
      if (custom.detail?.length) {
        validate(custom.detail);
        return;
      }
      consumePendingFiles();
    },
    [consumePendingFiles, disabled, validate],
  );

  // BaseLayout dispatches drops before/alongside hydration; also drain any stashed files.
  useEffect(() => {
    consumePendingFiles();
    window.addEventListener('geofiletools:files-dropped', handleDroppedFiles);
    return () => window.removeEventListener('geofiletools:files-dropped', handleDroppedFiles);
  }, [consumePendingFiles, handleDroppedFiles]);

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
    const onDrop = () => {
      setActive(false);
    };

    zone.addEventListener('dragenter', onDragEnter);
    zone.addEventListener('dragover', onDragOver);
    zone.addEventListener('dragleave', onDragLeave);
    zone.addEventListener('drop', onDrop);

    return () => {
      zone.removeEventListener('dragenter', onDragEnter);
      zone.removeEventListener('dragover', onDragOver);
      zone.removeEventListener('dragleave', onDragLeave);
      zone.removeEventListener('drop', onDrop);
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
      <label
        ref={zoneRef}
        htmlFor={disabled ? undefined : inputId}
        className={`${baseClass} ${idleClass} ${disabled ? disabledClass : enabledClass}`}
      >
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          className="sr-only"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          onChange={(e) => {
            if (e.target.files?.length) validate(e.target.files);
            e.target.value = '';
          }}
        />
        <p className="text-base font-medium text-slate-800">Drop files here</p>
        <p className="mt-2 text-sm text-slate-500">{hint}</p>
        <p className="mt-1 text-xs text-slate-400">Drop on this page (not the address bar)</p>
        <span className="pointer-events-none mt-4 inline-block rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm">
          Or click to browse files
        </span>
        <p className="mt-3 text-xs text-slate-400">Max {maxSizeMb} MB · processed locally in your browser</p>
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
