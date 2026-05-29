import { useState, useEffect, useCallback, useRef } from "react";

interface UseBarcodeDetectorOptions {
  onScan?: (barcode: string) => void;
  minLength?: number;
  maxInterKeyDelay?: number;
  enabled?: boolean;
}

interface BarcodeDetectorState {
  isHardwareScannerDetected: boolean;
  lastScanTime: Date | null;
  scanCount: number;
}

export function useBarcodeDetector({
  onScan,
  minLength = 3,
  maxInterKeyDelay = 50,
  enabled = true,
}: UseBarcodeDetectorOptions = {}) {
  const [state, setState] = useState<BarcodeDetectorState>({
    isHardwareScannerDetected: false,
    lastScanTime: null,
    scanCount: 0,
  });

  const bufferRef = useRef<string>("");
  const lastKeyTimeRef = useRef<number>(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const processBuffer = useCallback(() => {
    const buffer = bufferRef.current.trim();
    if (buffer.length >= minLength) {
      setState((prev) => ({
        isHardwareScannerDetected: true,
        lastScanTime: new Date(),
        scanCount: prev.scanCount + 1,
      }));
      onScan?.(buffer);
    }
    bufferRef.current = "";
  }, [minLength, onScan]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      const now = Date.now();
      const timeSinceLastKey = now - lastKeyTimeRef.current;

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      if (timeSinceLastKey > maxInterKeyDelay && bufferRef.current.length > 0) {
        bufferRef.current = "";
      }

      if (e.key === "Enter") {
        e.preventDefault();
        processBuffer();
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (timeSinceLastKey <= maxInterKeyDelay || bufferRef.current.length === 0) {
          bufferRef.current += e.key;
          lastKeyTimeRef.current = now;

          timeoutRef.current = setTimeout(() => {
            if (bufferRef.current.length >= minLength) {
              processBuffer();
            } else {
              bufferRef.current = "";
            }
          }, maxInterKeyDelay * 2);
        }
      }
    },
    [enabled, maxInterKeyDelay, minLength, processBuffer]
  );

  useEffect(() => {
    if (!enabled) return;

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [enabled, handleKeyDown]);

  const reset = useCallback(() => {
    bufferRef.current = "";
    lastKeyTimeRef.current = 0;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setState({
      isHardwareScannerDetected: false,
      lastScanTime: null,
      scanCount: 0,
    });
  }, []);

  return {
    ...state,
    reset,
  };
}
