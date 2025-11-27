import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Upload, ArrowRight, ArrowLeft, CheckCircle2, AlertCircle, Download, HelpCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

type ImportStep = "upload" | "map" | "strategy" | "preview" | "results";

interface ColumnMapping {
  [csvColumn: string]: string | null;
}

interface PreviewRow {
  rowNumber: number;
  action: "create" | "update" | "conflict" | "invalid";
  data: any;
  error?: string;
}

interface ImportResults {
  success: boolean;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{
    rowNumber: number;
    error: string;
    data: any;
  }>;
}

interface ImportWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportWizard({ open, onOpenChange }: ImportWizardProps) {
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState<ImportStep>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({});
  const [matchStrategy, setMatchStrategy] = useState<"sku" | "barcodeValue" | "both">("sku");
  const [preview, setPreview] = useState<any>(null);
  const [results, setResults] = useState<ImportResults | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [availableColumns, setAvailableColumns] = useState<string[]>([]);

  const steps: { key: ImportStep; label: string; number: number }[] = [
    { key: "upload", label: "Upload File", number: 1 },
    { key: "map", label: "Map Columns", number: 2 },
    { key: "strategy", label: "Match Strategy", number: 3 },
    { key: "preview", label: "Preview", number: 4 },
    { key: "results", label: "Results", number: 5 },
  ];

  const currentStepIndex = steps.findIndex((s) => s.key === currentStep);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const response = await fetch("/api/import/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Failed to upload file");
      }

      const data = await response.json();
      setAvailableColumns(data.headers || []);
      setColumnMapping(data.suggestedMapping || {});
      setCurrentStep("map");
    } catch (error: any) {
      toast({
        title: "Upload Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handlePreview = async () => {
    if (!file) return;

    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("columnMapping", JSON.stringify(columnMapping));
      formData.append("matchStrategy", matchStrategy);

      const response = await fetch("/api/import/preview", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Failed to preview import");
      }

      const data = await response.json();
      setPreview(data);
      setCurrentStep("preview");
    } catch (error: any) {
      toast({
        title: "Preview Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleExecute = async () => {
    if (!file) return;

    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("columnMapping", JSON.stringify(columnMapping));
      formData.append("matchStrategy", matchStrategy);

      const response = await fetch("/api/import/execute", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Failed to execute import");
      }

      const data = await response.json();
      setResults(data);
      setCurrentStep("results");
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
    } catch (error: any) {
      toast({
        title: "Import Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownloadErrors = () => {
    if (!results || results.errors.length === 0) return;

    const csv = [
      ["Row Number", "Error", "Data"].join(","),
      ...results.errors.map((err) =>
        [err.rowNumber, `"${err.error.replace(/"/g, '""')}"`, `"${JSON.stringify(err.data).replace(/"/g, '""')}"`].join(",")
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `import-errors-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    document.body.removeChild(a);

    toast({
      title: "Download Complete",
      description: "Error report downloaded successfully",
    });
  };

  const handleReset = () => {
    setCurrentStep("upload");
    setFile(null);
    setColumnMapping({});
    setMatchStrategy("sku");
    setPreview(null);
    setResults(null);
    setAvailableColumns([]);
  };

  const handleClose = () => {
    handleReset();
    onOpenChange(false);
  };

  const targetFields = [
    { key: "name", label: "Name", required: true },
    { key: "sku", label: "SKU", required: true },
    { key: "barcodeValue", label: "Barcode Value", required: false },
    { key: "productKind", label: "Product Kind", required: false },
    { key: "barcodeUsage", label: "Barcode Usage", required: false },
    { key: "barcodeFormat", label: "Barcode Format", required: false },
    { key: "currentStock", label: "Current Stock", required: false },
    { key: "minStock", label: "Min Stock", required: false },
    { key: "dailyUsage", label: "Daily Usage", required: false },
    { key: "unit", label: "Unit", required: false },
    { key: "location", label: "Location", required: false },
  ];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Barcode Import</DialogTitle>
        </DialogHeader>

        {/* Step Indicator */}
        <div className="flex items-center justify-between mb-6">
          {steps.map((step, index) => (
            <div key={step.key} className="flex items-center">
              <div
                className={`flex items-center justify-center w-8 h-8 rounded-full border-2 ${
                  index <= currentStepIndex
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground text-muted-foreground"
                }`}
                data-testid={`step-indicator-${step.number}`}
              >
                {index < currentStepIndex ? (
                  <CheckCircle2 className="h-5 w-5" />
                ) : (
                  <span className="text-sm font-medium">{step.number}</span>
                )}
              </div>
              <div className="ml-2">
                <div className={`text-sm font-medium ${index <= currentStepIndex ? "text-foreground" : "text-muted-foreground"}`}>
                  {step.label}
                </div>
              </div>
              {index < steps.length - 1 && <ArrowRight className="mx-4 h-4 w-4 text-muted-foreground" />}
            </div>
          ))}
        </div>

        {/* Step 1: Upload */}
        {currentStep === "upload" && (
          <Card>
            <CardHeader>
              <CardTitle>Upload CSV or Excel File</CardTitle>
              <CardDescription>Select a file containing your inventory items</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border-2 border-dashed rounded-lg p-12 text-center">
                <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-sm text-muted-foreground mb-4">Click to select a file or drag and drop</p>
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileSelect}
                  className="hidden"
                  id="file-upload"
                  data-testid="input-file-upload"
                />
                <Button variant="outline" onClick={() => document.getElementById("file-upload")?.click()} disabled={isLoading}>
                  {isLoading ? "Uploading..." : "Select File"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Map Columns */}
        {currentStep === "map" && (
          <Card>
            <CardHeader>
              <CardTitle>Map Columns</CardTitle>
              <CardDescription>Map your file columns to inventory fields</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {targetFields.map((field) => (
                <div key={field.key} className="flex items-center gap-4">
                  <div className="flex-1">
                    <label className="text-sm font-medium">
                      {field.label}
                      {field.required && <span className="text-destructive ml-1">*</span>}
                      {field.key === "productKind" && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger>
                              <HelpCircle className="inline h-3 w-3 ml-1 text-muted-foreground" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="max-w-xs">
                                FINISHED = Sellable products with GS1 barcodes
                                <br />
                                RAW = Components/materials with internal codes
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                      {field.key === "barcodeUsage" && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger>
                              <HelpCircle className="inline h-3 w-3 ml-1 text-muted-foreground" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="max-w-xs">
                                EXTERNAL_GS1 = Industry-standard GS1 barcodes for retail
                                <br />
                                INTERNAL_STOCK = Internal warehouse tracking codes
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </label>
                  </div>
                  <div className="flex-1">
                    <Select
                      value={
                        Object.entries(columnMapping).find(([, target]) => target === field.key)?.[0] || "__none__"
                      }
                      onValueChange={(value) => {
                        const newMapping = { ...columnMapping };
                        Object.keys(newMapping).forEach((key) => {
                          if (newMapping[key] === field.key) {
                            newMapping[key] = null;
                          }
                        });
                        if (value && value !== "__none__") {
                          newMapping[value] = field.key;
                        }
                        setColumnMapping(newMapping);
                      }}
                    >
                      <SelectTrigger data-testid={`select-mapping-${field.key}`}>
                        <SelectValue placeholder="Select column..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {availableColumns.map((col) => (
                          <SelectItem key={col} value={col}>
                            {col}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={() => setCurrentStep("upload")} data-testid="button-back-to-upload">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back
                </Button>
                <Button onClick={() => setCurrentStep("strategy")} data-testid="button-next-to-strategy">
                  Next
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Match Strategy */}
        {currentStep === "strategy" && (
          <Card>
            <CardHeader>
              <CardTitle>Match Strategy</CardTitle>
              <CardDescription>Choose how to match existing items</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <label className="flex items-center space-x-3 p-4 border rounded-lg cursor-pointer hover-elevate">
                  <input
                    type="radio"
                    name="strategy"
                    value="sku"
                    checked={matchStrategy === "sku"}
                    onChange={(e) => setMatchStrategy(e.target.value as any)}
                    className="h-4 w-4"
                    data-testid="radio-strategy-sku"
                  />
                  <div className="flex-1">
                    <div className="font-medium">Match by SKU</div>
                    <div className="text-sm text-muted-foreground">
                      Update items with matching SKU, create new items for unmatched SKUs
                    </div>
                  </div>
                </label>
                <label className="flex items-center space-x-3 p-4 border rounded-lg cursor-pointer hover-elevate">
                  <input
                    type="radio"
                    name="strategy"
                    value="barcodeValue"
                    checked={matchStrategy === "barcodeValue"}
                    onChange={(e) => setMatchStrategy(e.target.value as any)}
                    className="h-4 w-4"
                    data-testid="radio-strategy-barcode"
                  />
                  <div className="flex-1">
                    <div className="font-medium">Match by Barcode</div>
                    <div className="text-sm text-muted-foreground">
                      Update items with matching barcode value, create new items for unmatched barcodes
                    </div>
                  </div>
                </label>
                <label className="flex items-center space-x-3 p-4 border rounded-lg cursor-pointer hover-elevate">
                  <input
                    type="radio"
                    name="strategy"
                    value="both"
                    checked={matchStrategy === "both"}
                    onChange={(e) => setMatchStrategy(e.target.value as any)}
                    className="h-4 w-4"
                    data-testid="radio-strategy-both"
                  />
                  <div className="flex-1">
                    <div className="font-medium">Match by SKU or Barcode</div>
                    <div className="text-sm text-muted-foreground">
                      Update items matching either SKU or barcode, create new items only if both are unmatched
                    </div>
                  </div>
                </label>
              </div>
              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={() => setCurrentStep("map")} data-testid="button-back-to-map">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back
                </Button>
                <Button onClick={handlePreview} disabled={isLoading} data-testid="button-preview">
                  {isLoading ? "Loading..." : "Preview Import"}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 4: Preview */}
        {currentStep === "preview" && preview && (
          <Card>
            <CardHeader>
              <CardTitle>Preview Import</CardTitle>
              <CardDescription>Review the actions that will be performed</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-4 gap-4">
                <Card>
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold text-green-600">{preview.newItems || 0}</div>
                    <div className="text-sm text-muted-foreground">New Items</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold text-blue-600">{preview.updates || 0}</div>
                    <div className="text-sm text-muted-foreground">Updates</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold text-yellow-600">{preview.conflicts || 0}</div>
                    <div className="text-sm text-muted-foreground">Conflicts</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold text-red-600">{preview.invalid || 0}</div>
                    <div className="text-sm text-muted-foreground">Invalid</div>
                  </CardContent>
                </Card>
              </div>

              {preview.sampleRows && preview.sampleRows.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Sample Rows (first 10)</h4>
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Row</TableHead>
                          <TableHead>Action</TableHead>
                          <TableHead>Name</TableHead>
                          <TableHead>SKU</TableHead>
                          <TableHead>Barcode</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.sampleRows.slice(0, 10).map((row: PreviewRow) => (
                          <TableRow key={row.rowNumber}>
                            <TableCell>{row.rowNumber}</TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  row.action === "create"
                                    ? "default"
                                    : row.action === "update"
                                    ? "secondary"
                                    : row.action === "conflict"
                                    ? "outline"
                                    : "destructive"
                                }
                              >
                                {row.action}
                              </Badge>
                            </TableCell>
                            <TableCell>{row.data.name || "-"}</TableCell>
                            <TableCell>{row.data.sku || "-"}</TableCell>
                            <TableCell>{row.data.barcodeValue || "-"}</TableCell>
                            <TableCell>
                              {row.error ? (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <AlertCircle className="h-4 w-4 text-destructive" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p className="max-w-xs">{row.error}</p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              ) : (
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={() => setCurrentStep("strategy")} data-testid="button-back-to-strategy">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back
                </Button>
                <Button onClick={handleExecute} disabled={isLoading} data-testid="button-execute">
                  {isLoading ? "Importing..." : "Execute Import"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 5: Results */}
        {currentStep === "results" && results && (
          <Card>
            <CardHeader>
              <CardTitle>
                {results.success 
                  ? `Congratulations! You've successfully imported ${file?.name || 'your file'}`
                  : "Import Complete"
                }
              </CardTitle>
              <CardDescription>Summary of import results</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {results.success ? (
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertDescription>All records processed successfully!</AlertDescription>
                </Alert>
              ) : (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>Import completed with some errors</AlertDescription>
                </Alert>
              )}

              <div className="grid grid-cols-4 gap-4">
                <Card>
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold text-green-600">{results.inserted}</div>
                    <div className="text-sm text-muted-foreground">Inserted</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold text-blue-600">{results.updated}</div>
                    <div className="text-sm text-muted-foreground">Updated</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold text-yellow-600">{results.skipped}</div>
                    <div className="text-sm text-muted-foreground">Skipped</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold text-red-600">{results.failed}</div>
                    <div className="text-sm text-muted-foreground">Failed</div>
                  </CardContent>
                </Card>
              </div>

              {results.errors && results.errors.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium">Errors ({results.errors.length})</h4>
                    <Button size="sm" variant="outline" onClick={handleDownloadErrors} data-testid="button-download-errors">
                      <Download className="mr-2 h-4 w-4" />
                      Download Error Report
                    </Button>
                  </div>
                  <div className="border rounded-lg overflow-hidden max-h-60 overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Row</TableHead>
                          <TableHead>Error</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {results.errors.slice(0, 20).map((err, idx) => (
                          <TableRow key={idx}>
                            <TableCell>{err.rowNumber}</TableCell>
                            <TableCell className="text-sm text-destructive">{err.error}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-4">
                <Button onClick={handleClose} data-testid="button-close">
                  Close
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </DialogContent>
    </Dialog>
  );
}
