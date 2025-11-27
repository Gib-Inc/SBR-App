import { useState, useEffect, useRef, useCallback } from "react";
import { BrowserMultiFormatReader, NotFoundException } from "@zxing/library";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Camera, CameraOff, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";

interface CameraBarcodeScannerProps {
  onScan: (barcode: string) => void;
  onClose?: () => void;
  enabled?: boolean;
}

type CameraState = "idle" | "requesting" | "active" | "error" | "denied";

export function CameraBarcodeScanner({
  onScan,
  onClose,
  enabled = true,
}: CameraBarcodeScannerProps) {
  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = useCallback(() => {
    if (readerRef.current) {
      readerRef.current.reset();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraState("idle");
    setLastScannedCode(null);
  }, []);

  const getVideoDevices = useCallback(async () => {
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = allDevices.filter((d) => d.kind === "videoinput");
      setDevices(videoDevices);
      
      const backCamera = videoDevices.find(
        (d) => d.label.toLowerCase().includes("back") || d.label.toLowerCase().includes("rear")
      );
      if (backCamera) {
        setSelectedDeviceId(backCamera.deviceId);
      } else if (videoDevices.length > 0) {
        setSelectedDeviceId(videoDevices[0].deviceId);
      }
      
      return videoDevices;
    } catch (err) {
      console.error("Failed to enumerate devices:", err);
      return [];
    }
  }, []);

  const startCamera = useCallback(async () => {
    if (!enabled) return;

    setCameraState("requesting");
    setErrorMessage(null);

    try {
      const videoDevices = devices.length > 0 ? devices : await getVideoDevices();

      if (videoDevices.length === 0) {
        setCameraState("error");
        setErrorMessage("No camera found on this device");
        return;
      }

      const deviceId = selectedDeviceId || videoDevices[0]?.deviceId;
      
      const constraints: MediaStreamConstraints = {
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          facingMode: deviceId ? undefined : { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      if (!readerRef.current) {
        readerRef.current = new BrowserMultiFormatReader();
      }

      setCameraState("active");

      readerRef.current.decodeFromVideoDevice(
        deviceId,
        videoRef.current!,
        (result, error) => {
          if (result) {
            const code = result.getText();
            if (code !== lastScannedCode) {
              setLastScannedCode(code);
              onScan(code);
            }
          }
          if (error && !(error instanceof NotFoundException)) {
            console.warn("Decode error:", error);
          }
        }
      );
    } catch (err: any) {
      console.error("Camera error:", err);
      
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setCameraState("denied");
        setErrorMessage("Camera permission denied. Please allow camera access and try again.");
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        setCameraState("error");
        setErrorMessage("No camera found on this device");
      } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
        setCameraState("error");
        setErrorMessage("Camera is in use by another application");
      } else {
        setCameraState("error");
        setErrorMessage(err.message || "Failed to access camera");
      }
    }
  }, [enabled, devices, selectedDeviceId, getVideoDevices, lastScannedCode, onScan]);

  const switchCamera = useCallback(
    async (deviceId: string) => {
      setSelectedDeviceId(deviceId);
      stopCamera();
      setTimeout(() => {
        startCamera();
      }, 100);
    },
    [stopCamera, startCamera]
  );

  useEffect(() => {
    if (enabled) {
      getVideoDevices();
    } else {
      // Stop camera when disabled (e.g., switching to keyboard tab)
      stopCamera();
    }
  }, [enabled, getVideoDevices, stopCamera]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  useEffect(() => {
    if (lastScannedCode) {
      const timeout = setTimeout(() => {
        setLastScannedCode(null);
      }, 2000);
      return () => clearTimeout(timeout);
    }
  }, [lastScannedCode]);

  if (!enabled) {
    return null;
  }

  return (
    <div className="space-y-3">
      {cameraState === "idle" && (
        <div className="flex flex-col items-center justify-center p-6 border rounded-lg bg-muted/30">
          <Camera className="h-12 w-12 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground mb-4 text-center">
            Use your camera to scan barcodes
          </p>
          <Button onClick={startCamera} data-testid="button-start-camera">
            <Camera className="mr-2 h-4 w-4" />
            Start Camera
          </Button>
        </div>
      )}

      {cameraState === "requesting" && (
        <div className="flex flex-col items-center justify-center p-6 border rounded-lg bg-muted/30">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">Requesting camera access...</p>
        </div>
      )}

      {(cameraState === "error" || cameraState === "denied") && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>{errorMessage}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={startCamera}
              className="ml-4"
              data-testid="button-retry-camera"
            >
              <RefreshCw className="mr-2 h-3 w-3" />
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {cameraState === "active" && (
        <div className="space-y-3">
          <div className="relative rounded-lg overflow-hidden bg-black">
            <video
              ref={videoRef}
              className="w-full aspect-video object-cover"
              playsInline
              muted
              data-testid="video-camera-feed"
            />
            
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-3/4 h-1/3 border-2 border-primary/70 rounded-lg">
                <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-primary rounded-tl-lg" />
                <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-primary rounded-tr-lg" />
                <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-primary rounded-bl-lg" />
                <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-primary rounded-br-lg" />
              </div>
            </div>

            {lastScannedCode && (
              <div className="absolute bottom-2 left-2 right-2 bg-green-600/90 text-white p-2 rounded-lg flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span className="text-sm font-mono truncate">{lastScannedCode}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {devices.length > 1 && (
              <Select value={selectedDeviceId} onValueChange={switchCamera}>
                <SelectTrigger className="flex-1" data-testid="select-camera">
                  <SelectValue placeholder="Select camera" />
                </SelectTrigger>
                <SelectContent>
                  {devices.map((device) => (
                    <SelectItem key={device.deviceId} value={device.deviceId}>
                      {device.label || `Camera ${devices.indexOf(device) + 1}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            
            <Button
              variant="outline"
              onClick={stopCamera}
              data-testid="button-stop-camera"
            >
              <CameraOff className="mr-2 h-4 w-4" />
              Stop
            </Button>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            Position the barcode within the frame for automatic scanning
          </p>
        </div>
      )}
    </div>
  );
}
