import { useCallback, useRef } from 'react';
import type { Palette } from '../palettes';

interface WorkerResult {
  pixels: Uint8Array;
}

export function useFloydSteinberg() {
  const workerRef = useRef<Worker | null>(null);
  // Track pending request to prevent listener accumulation
  const pendingRejectRef = useRef<((error: Error) => void) | null>(null);

  const processFrame = useCallback(
    (pixels: Uint8Array, width: number, height: number, palette: Palette): Promise<Uint8Array> => {
      return new Promise((resolve, reject) => {
        // If there's a pending request, reject it
        if (pendingRejectRef.current) {
          pendingRejectRef.current(new Error('Superseded by new request'));
          pendingRejectRef.current = null;
        }

        if (!workerRef.current) {
          workerRef.current = new Worker(
            new URL('../workers/floydSteinberg.worker.ts', import.meta.url),
            { type: 'module' }
          );
        }

        const worker = workerRef.current;

        // Store reject function to cancel if new request comes in
        pendingRejectRef.current = reject;

        const handleMessage = (e: MessageEvent<WorkerResult>) => {
          worker.removeEventListener('message', handleMessage);
          worker.removeEventListener('error', handleError);
          pendingRejectRef.current = null;
          resolve(e.data.pixels);
        };

        const handleError = (e: ErrorEvent) => {
          worker.removeEventListener('message', handleMessage);
          worker.removeEventListener('error', handleError);
          pendingRejectRef.current = null;
          reject(e.error);
        };

        worker.addEventListener('message', handleMessage, { once: true });
        worker.addEventListener('error', handleError, { once: true });

        worker.postMessage(
          { pixels, width, height, palette },
          { transfer: [pixels.buffer] }
        );
      });
    },
    []
  );

  const terminate = useCallback(() => {
    if (pendingRejectRef.current) {
      pendingRejectRef.current(new Error('Worker terminated'));
      pendingRejectRef.current = null;
    }
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  return { processFrame, terminate };
}
