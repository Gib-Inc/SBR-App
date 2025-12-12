import { useState, useCallback, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Camera, Check, X, Loader2, AlertTriangle, Package, DollarSign, ImageIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ReturnItemForAssessment, ScanResult } from "@/hooks/use-unified-scanner";

interface ItemAssessment {
  id: string;
  isDamaged: boolean;
  damagePhotoUrl?: string;
}

interface DamageAssessmentDialogProps {
  open: boolean;
  onClose: () => void;
  scanResult: ScanResult | null;
}

export function DamageAssessmentDialog({ 
  open, 
  onClose, 
  scanResult 
}: DamageAssessmentDialogProps) {
  const { toast } = useToast();
  const [assessments, setAssessments] = useState<Map<string, ItemAssessment>>(new Map());
  const [capturingPhotoFor, setCapturingPhotoFor] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  const items = scanResult?.items || [];
  const DAMAGE_PERCENT = 0.10;

  const initializeAssessments = useCallback(() => {
    const newAssessments = new Map<string, ItemAssessment>();
    items.forEach(item => {
      newAssessments.set(item.id, {
        id: item.id,
        isDamaged: item.isDamaged || false,
        damagePhotoUrl: item.damagePhotoUrl,
      });
    });
    setAssessments(newAssessments);
  }, [items]);

  if (open && assessments.size === 0 && items.length > 0) {
    initializeAssessments();
  }

  const submitMutation = useMutation({
    mutationFn: async (data: { items: ItemAssessment[] }) => {
      const res = await apiRequest("POST", `/api/returns/${scanResult?.returnRequestId}/assess-damage`, data);
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to submit damage assessment");
      }
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/returns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shippo-label-logs"] });
      
      toast({
        title: "Damage Assessment Complete",
        description: `Final refund: $${result.finalRefundAmount?.toFixed(2) || '0.00'}`,
        className: "bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800",
      });
      
      handleClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Assessment Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const photoUploadMutation = useMutation({
    mutationFn: async (data: { base64Image: string; returnItemId: string; filename: string }) => {
      const res = await apiRequest("POST", "/api/returns/upload-damage-photo", data);
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to upload photo");
      }
      return res.json();
    },
    onSuccess: (result, variables) => {
      const newAssessments = new Map(assessments);
      const existing = newAssessments.get(variables.returnItemId);
      if (existing) {
        newAssessments.set(variables.returnItemId, {
          ...existing,
          damagePhotoUrl: result.photoUrl,
        });
        setAssessments(newAssessments);
      }
      
      toast({
        title: "Photo Uploaded",
        description: "Damage photo saved",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Upload Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleClose = () => {
    stopCamera();
    setAssessments(new Map());
    setCapturingPhotoFor(null);
    onClose();
  };

  const toggleDamaged = (itemId: string) => {
    const newAssessments = new Map(assessments);
    const existing = newAssessments.get(itemId);
    if (existing) {
      newAssessments.set(itemId, {
        ...existing,
        isDamaged: !existing.isDamaged,
      });
      setAssessments(newAssessments);
    }
  };

  const startCamera = async (itemId: string) => {
    setCapturingPhotoFor(itemId);
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch (err) {
      console.error("Camera error:", err);
      toast({
        title: "Camera Error",
        description: "Could not access camera",
        variant: "destructive",
      });
      setCapturingPhotoFor(null);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCapturingPhotoFor(null);
  };

  const capturePhoto = async () => {
    if (!videoRef.current || !capturingPhotoFor) return;
    
    setIsUploading(true);
    
    try {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(videoRef.current, 0, 0);
      
      const base64Image = canvas.toDataURL('image/jpeg', 0.8);
      
      await photoUploadMutation.mutateAsync({
        base64Image,
        returnItemId: capturingPhotoFor,
        filename: `damage_${scanResult?.rmaNumber || 'unknown'}_${Date.now()}`,
      });
      
      stopCamera();
    } catch (err) {
      console.error("Capture error:", err);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = () => {
    const itemsArray = Array.from(assessments.values());
    submitMutation.mutate({ items: itemsArray });
  };

  const calculateDamageDeduction = () => {
    let total = 0;
    assessments.forEach((assessment, itemId) => {
      if (assessment.isDamaged) {
        const item = items.find(i => i.id === itemId);
        if (item) {
          total += (item.lineTotal || 0) * DAMAGE_PERCENT;
        }
      }
    });
    return Math.min(total, scanResult?.baseRefundAmount || 0);
  };

  const damagedCount = Array.from(assessments.values()).filter(a => a.isDamaged).length;
  const damageDeduction = calculateDamageDeduction();
  const finalRefund = Math.max(0, (scanResult?.baseRefundAmount || 0) - damageDeduction);

  if (!scanResult) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Damage Assessment
          </DialogTitle>
          <DialogDescription>
            {scanResult.rmaNumber || `Return #${scanResult.returnRequestId?.slice(0, 8)}`}
            {scanResult.customerName && ` - ${scanResult.customerName}`}
          </DialogDescription>
        </DialogHeader>

        {capturingPhotoFor ? (
          <div className="space-y-4">
            <Alert>
              <Camera className="h-4 w-4" />
              <AlertDescription>
                Take a photo of the damaged item
              </AlertDescription>
            </Alert>
            
            <div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                autoPlay
                playsInline
                muted
              />
            </div>
            
            <div className="flex gap-2 justify-center">
              <Button
                onClick={capturePhoto}
                disabled={isUploading}
                data-testid="button-capture-photo"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Camera className="h-4 w-4 mr-2" />
                    Capture Photo
                  </>
                )}
              </Button>
              <Button variant="outline" onClick={stopCamera} data-testid="button-cancel-photo">
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {items.map((item) => {
                const assessment = assessments.get(item.id);
                const isDamaged = assessment?.isDamaged || false;
                const hasPhoto = !!assessment?.damagePhotoUrl;
                
                return (
                  <Card key={item.id} className={isDamaged ? "border-destructive" : ""}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate" data-testid={`text-item-name-${item.id}`}>
                            {item.productName}
                          </div>
                          <div className="text-sm text-muted-foreground flex items-center gap-2">
                            <span>SKU: {item.sku}</span>
                            <span>Qty: {item.qtyApproved}</span>
                            <span>${(item.lineTotal || 0).toFixed(2)}</span>
                          </div>
                          {isDamaged && (
                            <div className="text-xs text-destructive mt-1">
                              -${((item.lineTotal || 0) * DAMAGE_PERCENT).toFixed(2)} deduction (10%)
                            </div>
                          )}
                        </div>
                        
                        <div className="flex items-center gap-2">
                          {hasPhoto && (
                            <Badge variant="outline" className="gap-1">
                              <ImageIcon className="h-3 w-3" />
                              Photo
                            </Badge>
                          )}
                          
                          {isDamaged && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => startCamera(item.id)}
                              data-testid={`button-add-photo-${item.id}`}
                            >
                              <Camera className="h-4 w-4" />
                            </Button>
                          )}
                          
                          <Button
                            size="sm"
                            variant={isDamaged ? "destructive" : "outline"}
                            onClick={() => toggleDamaged(item.id)}
                            data-testid={`button-toggle-damage-${item.id}`}
                          >
                            {isDamaged ? (
                              <>
                                <AlertTriangle className="h-4 w-4 mr-1" />
                                Damaged
                              </>
                            ) : (
                              <>
                                <Check className="h-4 w-4 mr-1" />
                                Good
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <Card className="bg-muted/50">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">Refund Summary</div>
                    <div className="text-sm">
                      Base: ${(scanResult.baseRefundAmount || 0).toFixed(2)}
                      {damageDeduction > 0 && (
                        <span className="text-destructive ml-2">
                          - ${damageDeduction.toFixed(2)} damage
                        </span>
                      )}
                    </div>
                    {damagedCount > 0 && (
                      <div className="text-xs text-muted-foreground">
                        {damagedCount} damaged item(s) - stock will be deducted
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Final Refund</div>
                    <div className="text-2xl font-bold flex items-center gap-1">
                      <DollarSign className="h-5 w-5" />
                      {finalRefund.toFixed(2)}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {!capturingPhotoFor && (
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleClose} data-testid="button-cancel-assessment">
              Cancel
            </Button>
            <Button 
              onClick={handleSubmit} 
              disabled={submitMutation.isPending}
              data-testid="button-submit-assessment"
            >
              {submitMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Submitting...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Complete Assessment
                </>
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
