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
  const editableSnapshotRef = useRef<{
    element: HTMLInputElement | HTMLTextAreaElement;
    value: string;
    selectionStart: number | null;
    selectionEnd: number | null;
    restored: boolean;
  } | null>(null);

  const isEditableElement = (
    element: EventTarget | null,
  ): element is HTMLInputElement | HTMLTextAreaElement => {
    if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
      return false;
    }
    if (element.readOnly || element.disabled) return false;
    const type = element instanceof HTMLInputElement ? element.type : "textarea";
    return !["button", "checkbox", "color", "file", "hidden", "radio", "range", "reset", "submit"].includes(type);
  };

  const restoreEditableSnapshot = useCallback((force = false) => {
    const snapshot = editableSnapshotRef.current;
    if (!snapshot || (snapshot.restored && !force)) return;
    const { element, value, selectionStart, selectionEnd } = snapshot;
    const valueSetter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(element),
      "value",
    )?.set;
    if (valueSetter) {
      valueSetter.call(element, value);
    } else {
      element.value = value;
    }
    if (selectionStart != null && selectionEnd != null) {
      try {
        element.setSelectionRange(selectionStart, selectionEnd);
      } catch {
        // Some input types do not support selection ranges.
      }
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    snapshot.restored = true;
  }, []);

  const processBuffer = useCallback(() => {
    const buffer = bufferRef.current.trim();
    if (buffer.length >= minLength) {
      restoreEditableSnapshot(true);
      setState((prev) => ({
        isHardwareScannerDetected: true,
        lastScanTime: new Date(),
        scanCount: prev.scanCount + 1,
      }));
      onScan?.(buffer);
    }
    bufferRef.current = "";
    editableSnapshotRef.current = null;
  }, [minLength, onScan, restoreEditableSnapshot]);

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
        editableSnapshotRef.current = null;
      }

      if (e.key === "Enter") {
        if (bufferRef.current.length >= minLength) {
          e.preventDefault();
          e.stopPropagation();
          processBuffer();
        } else {
          bufferRef.current = "";
          editableSnapshotRef.current = null;
        }
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const isContinuingRapidScan =
          bufferRef.current.length > 0 && timeSinceLastKey <= maxInterKeyDelay;
        const isStartingNewBuffer = bufferRef.current.length === 0;

        if (isStartingNewBuffer && isEditableElement(e.target)) {
          editableSnapshotRef.current = {
            element: e.target,
            value: e.target.value,
            selectionStart: e.target.selectionStart,
            selectionEnd: e.target.selectionEnd,
            restored: false,
          };
        }

        if (timeSinceLastKey <= maxInterKeyDelay || bufferRef.current.length === 0) {
          if (isContinuingRapidScan) {
            restoreEditableSnapshot();
            e.preventDefault();
            e.stopPropagation();
          }
          bufferRef.current += e.key;
          lastKeyTimeRef.current = now;

          timeoutRef.current = setTimeout(() => {
            if (bufferRef.current.length >= minLength) {
              processBuffer();
            } else {
              bufferRef.current = "";
              editableSnapshotRef.current = null;
            }
          }, maxInterKeyDelay * 2);
        }
      }
    },
    [enabled, maxInterKeyDelay, minLength, processBuffer, restoreEditableSnapshot]
  );

  useEffect(() => {
    if (!enabled) return;

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [enabled, handleKeyDown]);

  const reset = useCallback(() => {
    bufferRef.current = "";
    lastKeyTimeRef.current = 0;
    editableSnapshotRef.current = null;
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
