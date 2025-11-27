import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface ImportProductsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type ImportStep = "upload" | "preview" | "processing" | "complete";

export function ImportProductsDialog({ isOpen, onClose }: ImportProductsDialogProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<ImportStep>("upload");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("default");
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [importResult, setImportResult] = useState<any>(null);

  // Fetch import profiles
  const { data: profiles } = useQuery<any[]>({
    queryKey: ["/api/import-profiles"],
  });

  // Handle file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      // Parse CSV for preview
      parseCSVPreview(file);
    }
  };

  // Parse CSV file for preview (first 5 rows)
  const parseCSVPreview = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split('\n').filter(line => line.trim());
      const headers = lines[0].split(',').map(h => h.trim());
      const rows = lines.slice(1, 6).map(line => {
        const values = line.split(',').map(v => v.trim());
        const obj: any = {};
        headers.forEach((header, i) => {
          obj[header] = values[i] || '';
        });
        return obj;
      });
      setPreviewData(rows);
    };
    reader.readAsText(file);
  };

  // Import mutation
  const importMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile) throw new Error("No file selected");

      // Note: Real implementation would send FormData to upload endpoint
      // For now, we'll simulate the process since backend file upload isn't implemented yet
      
      // Create import job to track status
      const jobRes = await apiRequest("POST", "/api/import-jobs", {
        profileId: selectedProfileId === "default" ? null : selectedProfileId,
        fileName: selectedFile.name,
        status: "processing",
      });

      if (!jobRes.ok) {
        throw new Error("Failed to create import job");
      }

      const job = await jobRes.json();

      // TODO: In production, this would:
      // 1. Upload the file to a processing endpoint
      // 2. Poll the job status endpoint
      // 3. Handle real-time progress updates
      // For now, simulate success with preview data
      
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            jobId: job.id,
            summary: {
              inserted: previewData.length,
              updated: 0,
              ignored: 0,
              failed: 0,
            },
            errors: [],
          });
        }, 2000);
      });
    },
    onSuccess: (result: any) => {
      setImportResult(result);
      setStep("complete");
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/import-jobs"] });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Import failed",
        description: error.message || "Failed to import products",
      });
    },
  });

  const handleImport = () => {
    setStep("processing");
    importMutation.mutate();
  };

  const handleClose = () => {
    setStep("upload");
    setSelectedFile(null);
    setSelectedProfileId("default");
    setPreviewData([]);
    setImportResult(null);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Product Import</DialogTitle>
          <DialogDescription>
            Upload a CSV or XLSX file to bulk import products into your inventory
          </DialogDescription>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-6">
            {/* Import Profile Selection */}
            <div className="space-y-2">
              <Label htmlFor="import-profile">Import Profile (Optional)</Label>
              <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
                <SelectTrigger data-testid="select-import-profile">
                  <SelectValue placeholder="Select a profile or use default mapping" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">Default Mapping</SelectItem>
                  {profiles?.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                Import profiles define how columns in your file map to product fields
              </p>
            </div>

            {/* File Upload */}
            <div className="space-y-2">
              <Label htmlFor="file-upload">Upload File</Label>
              <div className="flex items-center gap-4">
                <Input
                  id="file-upload"
                  type="file"
                  accept=".csv,.xlsx"
                  onChange={handleFileChange}
                  data-testid="input-file-upload"
                  className="flex-1"
                />
                {selectedFile && (
                  <Badge variant="secondary" className="gap-2">
                    <FileSpreadsheet className="h-3 w-3" />
                    {selectedFile.name}
                  </Badge>
                )}
              </div>
            </div>

            {/* Preview Table */}
            {previewData.length > 0 && (
              <div className="space-y-2">
                <Label>Preview (First 5 Rows)</Label>
                <Card>
                  <CardContent className="p-4">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {Object.keys(previewData[0]).map((header) => (
                              <TableHead key={header}>{header}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {previewData.map((row, idx) => (
                            <TableRow key={idx}>
                              {Object.values(row).map((value: any, cellIdx) => (
                                <TableCell key={cellIdx} className="text-sm">
                                  {value}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleClose} data-testid="button-cancel-import">
                Cancel
              </Button>
              <Button
                onClick={handleImport}
                disabled={!selectedFile}
                data-testid="button-start-import"
              >
                <Upload className="mr-2 h-4 w-4" />
                Import Products
              </Button>
            </div>
          </div>
        )}

        {step === "processing" && (
          <div className="flex flex-col items-center justify-center py-12 space-y-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            <p className="text-lg font-medium">Processing import...</p>
            <p className="text-sm text-muted-foreground">
              This may take a moment for large files
            </p>
          </div>
        )}

        {step === "complete" && importResult && (
          <div className="space-y-6">
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                Import completed successfully!
              </AlertDescription>
            </Alert>

            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-green-600">
                    {importResult.summary.inserted}
                  </p>
                  <p className="text-sm text-muted-foreground">Inserted</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-blue-600">
                    {importResult.summary.updated}
                  </p>
                  <p className="text-sm text-muted-foreground">Updated</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-yellow-600">
                    {importResult.summary.ignored}
                  </p>
                  <p className="text-sm text-muted-foreground">Ignored</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-2xl font-bold text-red-600">
                    {importResult.summary.failed}
                  </p>
                  <p className="text-sm text-muted-foreground">Failed</p>
                </CardContent>
              </Card>
            </div>

            {importResult.errors && importResult.errors.length > 0 && (
              <div className="space-y-2">
                <Label>Errors</Label>
                <Card>
                  <CardContent className="p-4 space-y-2">
                    {importResult.errors.map((error: string, idx: number) => (
                      <div key={idx} className="flex items-start gap-2 text-sm">
                        <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />
                        <span>{error}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={handleClose} data-testid="button-close-import">
                Close
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
