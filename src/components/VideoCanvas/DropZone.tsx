import { useCallback, useState } from 'react';

interface DropZoneProps {
  onVideoLoad: (src: string, name: string) => void;
}

export function DropZone({ onVideoLoad }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.type.startsWith('video/')) {
        const url = URL.createObjectURL(file);
        onVideoLoad(url, file.name);
      }
    }
  }, [onVideoLoad]);

  const handleClick = useCallback(async () => {
    const picked = await window.electronAPI?.openVideo?.();
    if (picked) {
      onVideoLoad(picked.url, picked.name);
    }
  }, [onVideoLoad]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  }, [handleClick]);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Drop video file or click to browse"
      className={`
        absolute inset-0 flex flex-col items-center justify-center
        border-2 border-dashed rounded-lg m-8 cursor-pointer
        transition-all duration-200
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gb-light focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-900
        ${isDragging
          ? 'border-gb-light bg-gb-light/10 drop-zone-active'
          : 'border-neutral-700 hover:border-neutral-500 bg-neutral-900/50'
        }
      `}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <div className="text-center p-8">
        <div className="mb-4">
          <svg
            aria-hidden="true"
            className={`w-16 h-16 mx-auto ${isDragging ? 'text-gb-light' : 'text-neutral-600'}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
        </div>
        <p className={`text-lg font-medium ${isDragging ? 'text-gb-light' : 'text-neutral-400'}`}>
          Drop video here
        </p>
        <p className="text-sm text-neutral-500 mt-2">
          or click to browse
        </p>
        <p className="text-xs text-neutral-600 mt-4">
          MP4, WebM, MOV, AVI, MKV
        </p>
      </div>
    </div>
  );
}
