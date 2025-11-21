import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Download, Printer, Barcode as BarcodeIcon } from "lucide-react";

export default function Barcodes() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  // Fetch barcodes
  const { data: barcodes, isLoading } = useQuery({
    queryKey: ["/api/barcodes"],
  });

  const filteredBarcodes = (barcodes ?? []).filter((barcode: any) =>
    barcode.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (barcode.sku && barcode.sku.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const handlePrint = (barcode: any) => {
    // Open print dialog with barcode
    const printWindow = window.open(`/print/barcode/${barcode.id}`, '_blank');
    if (printWindow) {
      printWindow.onload = () => {
        printWindow.print();
      };
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Barcodes</h1>
          <p className="text-sm text-muted-foreground">Manage barcodes for items and bins</p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-barcode">
              <Plus className="mr-2 h-4 w-4" />
              Create Barcode
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Barcode</DialogTitle>
            </DialogHeader>
            <BarcodeForm onClose={() => setIsCreateDialogOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      {/* Search Bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search barcodes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-barcodes"
          />
        </div>
      </div>

      {/* Barcodes Grid */}
      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        </div>
      ) : filteredBarcodes.length === 0 ? (
        <Card>
          <CardContent className="flex h-64 flex-col items-center justify-center gap-2">
            <BarcodeIcon className="h-12 w-12 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {searchQuery ? "No barcodes found" : "No barcodes yet. Create your first barcode to get started."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredBarcodes.map((barcode: any) => (
            <Card key={barcode.id} className="hover-elevate">
              <CardContent className="flex flex-col gap-4 pt-6">
                {/* Barcode Image Placeholder */}
                <div className="flex aspect-[3/1] items-center justify-center rounded-md border bg-muted">
                  <div className="flex flex-col items-center gap-2">
                    <BarcodeIcon className="h-8 w-8 text-muted-foreground" />
                    <span className="font-mono text-xs text-muted-foreground">{barcode.value}</span>
                  </div>
                </div>

                {/* Barcode Details */}
                <div className="space-y-2">
                  <div>
                    <p className="font-medium" data-testid={`text-barcode-name-${barcode.id}`}>
                      {barcode.name}
                    </p>
                    {barcode.sku && (
                      <p className="font-mono text-sm text-muted-foreground">{barcode.sku}</p>
                    )}
                  </div>
                  <Badge variant="secondary" data-testid={`badge-purpose-${barcode.id}`}>
                    {barcode.purpose}
                  </Badge>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => handlePrint(barcode)}
                    data-testid={`button-print-${barcode.id}`}
                  >
                    <Printer className="mr-2 h-4 w-4" />
                    Print
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    data-testid={`button-download-${barcode.id}`}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Print Layout Info */}
      <Card className="bg-muted/50">
        <CardContent className="flex items-center gap-3 pt-6">
          <BarcodeIcon className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Print on plain paper</p>
            <p className="text-xs text-muted-foreground">
              Barcodes are optimized for standard A4/Letter paper printing
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function BarcodeForm({ onClose }: { onClose: () => void }) {
  const { data: items } = useQuery({
    queryKey: ["/api/items"],
  });

  const { data: bins } = useQuery({
    queryKey: ["/api/bins"],
  });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="barcode-name">Name</Label>
        <Input
          id="barcode-name"
          placeholder="e.g., Bin A-1 Barcode"
          data-testid="input-barcode-name"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="barcode-value">Barcode Value</Label>
        <Input
          id="barcode-value"
          placeholder="e.g., BIN-A1-001"
          className="font-mono"
          data-testid="input-barcode-value"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="barcode-purpose">Purpose</Label>
        <Select defaultValue="bin">
          <SelectTrigger id="barcode-purpose" data-testid="select-barcode-purpose">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="component">Component</SelectItem>
            <SelectItem value="finished_product">Finished Product</SelectItem>
            <SelectItem value="bin">Bin Location</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="barcode-sku">SKU (Optional)</Label>
        <Input
          id="barcode-sku"
          placeholder="e.g., BIN-A1"
          className="font-mono"
          data-testid="input-barcode-sku"
        />
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button variant="outline" onClick={onClose} data-testid="button-cancel">
          Cancel
        </Button>
        <Button data-testid="button-save-barcode">Create Barcode</Button>
      </div>
    </div>
  );
}
