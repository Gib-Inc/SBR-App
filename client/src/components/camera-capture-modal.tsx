import { useState, useRef, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, Upload, X, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface CameraCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImageCaptured: (imageDataUrl: string) => void;
}

export function CameraCaptureModal({ isOpen, onClose, onImageCaptured }: CameraCaptureModalProps) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen && !capturedImage) {
      startCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen]);

  const startCamera = async () => {
    try {
      setCameraError(null);
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (error: any) {
      console.error("Camera access error:", error);
      setCameraError("Camera access denied. Please use file upload instead.");
      toast({
        variant: "destructive",
        title: "Camera Access Denied",
        description: "Please enable camera permissions or upload an image file.",
      });
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  const captureImage = () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(video, 0, 0);
      const imageDataUrl = canvas.toDataURL("image/jpeg", 0.9);
      setCapturedImage(imageDataUrl);
      stopCamera();
    }
  };

  const retake = () => {
    setCapturedImage(null);
    startCamera();
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast({
        variant: "destructive",
        title: "Invalid File",
        description: "Please select an image file.",
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const imageDataUrl = e.target?.result as string;
      setCapturedImage(imageDataUrl);
      stopCamera();
    };
    reader.readAsDataURL(file);
  };

  const handleConfirm = () => {
    if (capturedImage) {
      onImageCaptured(capturedImage);
      handleClose();
    }
  };

  const handleClose = () => {
    stopCamera();
    setCapturedImage(null);
    setCameraError(null);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Scan Inventory Item</DialogTitle>
          <DialogDescription>
            Take a photo or upload an image of the item to identify it with AI
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Camera/Image Preview */}
          <div className="relative aspect-video overflow-hidden rounded-md border bg-black">
            {capturedImage ? (
              <img
                src={capturedImage}
                alt="Captured"
                className="h-full w-full object-contain"
                data-testid="img-captured"
              />
            ) : (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  className="h-full w-full object-cover"
                  data-testid="video-camera-preview"
                />
                <canvas ref={canvasRef} className="hidden" />
              </>
            )}

            {cameraError && !capturedImage && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                <div className="text-center text-white p-4">
                  <Camera className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">{cameraError}</p>
                </div>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex gap-2 justify-between">
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileUpload}
                data-testid="input-file-upload"
              />
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                data-testid="button-upload-image"
              >
                <Upload className="mr-2 h-4 w-4" />
                Upload Image
              </Button>
            </div>

            <div className="flex gap-2">
              {capturedImage ? (
                <>
                  <Button
                    variant="outline"
                    onClick={retake}
                    data-testid="button-retake"
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Retake
                  </Button>
                  <Button
                    onClick={handleConfirm}
                    data-testid="button-confirm-image"
                  >
                    Analyze Image
                  </Button>
                </>
              ) : (
                <Button
                  onClick={captureImage}
                  disabled={!!cameraError}
                  data-testid="button-capture"
                >
                  <Camera className="mr-2 h-4 w-4" />
                  Capture Photo
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
