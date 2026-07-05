import { useState } from 'react';

interface DownloadButtonProps {
  blob: Blob;
  fileName: string;
  label?: string;
}

export function DownloadButton({ blob, fileName, label = 'Download result' }: DownloadButtonProps) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = () => {
    if (downloading) return;
    setDownloading(true);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    // Delay revocation so the browser finishes reading the blob
    setTimeout(() => {
      URL.revokeObjectURL(url);
      setDownloading(false);
    }, 10_000);
  };

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={downloading}
      className="inline-flex items-center justify-center rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50 disabled:cursor-wait"
    >
      {downloading ? 'Downloading…' : label}
    </button>
  );
}
