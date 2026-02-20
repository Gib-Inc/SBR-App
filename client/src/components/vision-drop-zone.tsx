import { useState, useRef, useCallback } from "react";
import { Loader2, ImageIcon, X, Camera } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

/** Resize image to maxDim on longest side, return base64 (no data: prefix) */
function resizeAndEncode(file: File, maxDim: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      resolve(dataUrl.split(",")[1]);
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = URL.createObjectURL(file);
  });
}

interface VisionDropZoneProps {
  entityType: "suppliers" | "products" | "barcodes" | "inventory";
  onExtracted: (records: any[]) => void;
  maxFiles?: number;
  compact?: boolean;
}

export function VisionDropZone({ entityType, onExtracted, maxFiles = 15, compact = false }: VisionDropZoneProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<{ file: File; preview: string; status: "pending" | "processing" | "done" | "error" }[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const processFiles = useCallback(async (newFiles: File[]) => {
    const imageFiles = newFiles.filter(f => f.type.startsWith("image/")).slice(0, maxFiles);
    if (imageFiles.length === 0) return;

    const fileEntries = imageFiles.map(file => ({
      file,
      preview: URL.createObjectURL(file),
      status: "pending" as const,
    }));

    setFiles(prev => [...prev, ...fileEntries].slice(0, maxFiles));
    setIsProcessing(true);

    const allRecords: any[] = [];

    for (let i = 0; i < fileEntries.length; i++) {
      const entry = fileEntries[i];
      setFiles(prev => prev.map(f => f.preview === entry.preview ? { ...f, status: "processing" } : f));

      try {
        // Resize image to max 2000px on longest side to keep payload reasonable
        const base64 = await resizeAndEncode(entry.file, 2000);

        const res = await apiRequest("POST", "/api/import/extract-from-image", {
          imageBase64: base64,
          mediaType: "image/jpeg",
          entityType: entityType === "inventory" ? "products" : entityType,
        });

        const data = await res.json();
        if (data.error) throw new Error(data.error);

        const records = data.records || [];
        allRecords.push(...records);
        setFiles(prev => prev.map(f => f.preview === entry.preview ? { ...f, status: "done" } : f));
      } catch (err: any) {
        setFiles(prev => prev.map(f => f.preview === entry.preview ? { ...f, status: "error" } : f));
        toast({
          title: "Failed to read image",
          description: err.message,
          variant: "destructive",
        });
      }
    }

    if (allRecords.length > 0) {
      onExtracted(allRecords);
      toast({
        title: `Found ${allRecords.length} ${entityType}`,
        description: "Review below and submit when ready.",
      });
    }

    setIsProcessing(false);
  }, [entityType, maxFiles, onExtracted, toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    processFiles(droppedFiles);
  }, [processFiles]);

  const handleSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    processFiles(selected);
    e.target.value = "";
  }, [processFiles]);

  const removeFile = useCallback((preview: string) => {
    setFiles(prev => {
      const updated = prev.filter(f => f.preview !== preview);
      URL.revokeObjectURL(preview);
      return updated;
    });
  }, []);

  const clearAll = useCallback(() => {
    files.forEach(f => URL.revokeObjectURL(f.preview));
    setFiles([]);
  }, [files]);

  const contextLabel = entityType === "suppliers"
    ? "business cards, supplier lists, invoices, Amazon pages, catalogs"
    : entityType === "products"
    ? "spreadsheets, catalogs, Katana exports, Shopify screens, inventory lists"
    : entityType === "inventory"
    ? "photos of physical items to identify and count"
    : "barcode lists, product labels, shipping documents";

  return (
    <div className="space-y-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleSelect}
      />

      {/* Drop zone */}
      <div
        className={`relative border-2 border-dashed rounded-lg transition-all cursor-pointer ${
          isDragOver
            ? "border-primary bg-primary/5 scale-[1.01]"
            : "border-muted-foreground/25 hover:border-primary/50"
        } ${compact ? "p-3" : "p-4"}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        onClick={() => !isProcessing && fileInputRef.current?.click()}
      >
        {isProcessing ? (
          <div className="flex items-center gap-3 justify-center py-2">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <div>
              <p className="text-sm font-medium">Claude is reading your images...</p>
              <p className="text-xs text-muted-foreground">Extracting {entityType} data</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 justify-center py-1">
            <Camera className={`${compact ? "h-5 w-5" : "h-6 w-6"} text-muted-foreground`} />
            <div>
              <p className="text-sm">
                <span className="font-medium text-primary">Drop screenshots</span>
                <span className="text-muted-foreground"> or click to browse</span>
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {contextLabel} — up to {maxFiles} images
              </p>
            </div>
          </div>
        )}
      </div>

      {/* File previews */}
      {files.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{files.length} image{files.length !== 1 ? "s" : ""}</span>
            {files.length > 1 && (
              <button onClick={(e) => { e.stopPropagation(); clearAll(); }} className="text-xs text-muted-foreground hover:text-foreground">
                Clear all
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {files.map((f) => (
              <div key={f.preview} className="relative group">
                <img
                  src={f.preview}
                  alt=""
                  className={`h-12 w-12 rounded border object-cover ${
                    f.status === "processing" ? "opacity-50 animate-pulse" :
                    f.status === "error" ? "opacity-50 border-red-500" :
                    f.status === "done" ? "border-green-500" : ""
                  }`}
                />
                {f.status === "done" && (
                  <div className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-green-500 flex items-center justify-center">
                    <svg className="h-2 w-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
                {f.status === "error" && (
                  <div className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-red-500 flex items-center justify-center">
                    <X className="h-2 w-2 text-white" />
                  </div>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); removeFile(f.preview); }}
                  className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-background border shadow-sm items-center justify-center hidden group-hover:flex"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
