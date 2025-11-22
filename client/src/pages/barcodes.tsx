import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Plus, Search, Download, Printer, Barcode as BarcodeIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

const barcodeFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  value: z.string().min(1, "Barcode value is required"),
  purpose: z.enum(["item", "bin", "finished_product"]),
  sku: z.string().optional(),
  referenceId: z.string().optional(),
});

function formatPurposeLabel(purpose: string): string {
  switch (purpose) {
    case "bin":
      return "Finished product";
    case "finished_product":
      return "Finished product";
    case "item":
      return "Item Inventory";
    default:
      return purpose;
  }
}

function BarcodeListItem({ barcode, onPrint }: { barcode: any; onPrint: (barcode: any) => void }) {
  return (
    <div className="flex items-center gap-4 rounded-md border bg-card p-4 hover-elevate">
      {/* Barcode Icon */}
      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-md border bg-muted">
        <BarcodeIcon className="h-6 w-6 text-muted-foreground" />
      </div>

      {/* Barcode Details */}
      <div className="flex-1 space-y-1">
        <p className="font-medium" data-testid={`text-barcode-name-${barcode.id}`}>
          {barcode.name}
        </p>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-muted-foreground">{barcode.value}</span>
          {barcode.sku && (
            <>
              <span className="text-muted-foreground">•</span>
              <span className="font-mono text-sm text-muted-foreground">{barcode.sku}</span>
            </>
          )}
        </div>
      </div>

      {/* Purpose Badge */}
      <Badge variant="secondary" data-testid={`badge-purpose-${barcode.id}`}>
        {formatPurposeLabel(barcode.purpose)}
      </Badge>

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPrint(barcode)}
          data-testid={`button-print-${barcode.id}`}
        >
          <Printer className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          data-testid={`button-download-${barcode.id}`}
        >
          <Download className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export default function Barcodes() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  // Fetch barcodes
  const { data: barcodes, isLoading } = useQuery({
    queryKey: ["/api/barcodes"],
  });

  const filteredBarcodes = ((barcodes as any[]) ?? []).filter((barcode: any) =>
    barcode.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (barcode.sku && barcode.sku.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const finishedProductBarcodes = filteredBarcodes.filter((b: any) => b.purpose === "finished_product" || b.purpose === "bin");
  const itemInventoryBarcodes = filteredBarcodes.filter((b: any) => b.purpose === "item");

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

      {/* Barcodes Sections */}
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
        <div className="flex flex-col gap-8">
          {/* Finished Products Section */}
          {finishedProductBarcodes.length > 0 && (
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="text-lg font-semibold">Finished Products</h2>
                <p className="text-sm text-muted-foreground">Barcodes for finished products</p>
              </div>
              <div className="flex flex-col gap-2">
                {finishedProductBarcodes.map((barcode: any) => (
                  <BarcodeListItem key={barcode.id} barcode={barcode} onPrint={handlePrint} />
                ))}
              </div>
            </div>
          )}

          {/* Item Inventory Section */}
          {itemInventoryBarcodes.length > 0 && (
            <div className="flex flex-col gap-4">
              <div>
                <h2 className="text-lg font-semibold">Item Inventory</h2>
                <p className="text-sm text-muted-foreground">Barcodes for inventory items and components</p>
              </div>
              <div className="flex flex-col gap-2">
                {itemInventoryBarcodes.map((barcode: any) => (
                  <BarcodeListItem key={barcode.id} barcode={barcode} onPrint={handlePrint} />
                ))}
              </div>
            </div>
          )}
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
  const { toast } = useToast();
  const { data: items } = useQuery({
    queryKey: ["/api/items"],
  });

  const { data: bins } = useQuery({
    queryKey: ["/api/bins"],
  });

  const form = useForm<z.infer<typeof barcodeFormSchema>>({
    resolver: zodResolver(barcodeFormSchema),
    defaultValues: {
      name: "",
      value: "",
      purpose: "bin",
      sku: "",
      referenceId: undefined,
    },
  });

  const createBarcodeMutation = useMutation({
    mutationFn: async (data: z.infer<typeof barcodeFormSchema>) => {
      const res = await apiRequest("POST", "/api/barcodes", data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/barcodes"] });
      toast({
        title: "Success",
        description: "Barcode created successfully",
      });
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create barcode",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: z.infer<typeof barcodeFormSchema>) => {
    createBarcodeMutation.mutate(data);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input
                  placeholder="e.g., Bin A-1 Barcode"
                  data-testid="input-barcode-name"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="value"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Barcode Value</FormLabel>
              <FormControl>
                <Input
                  placeholder="e.g., BIN-A1-001"
                  className="font-mono"
                  data-testid="input-barcode-value"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="purpose"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Purpose</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger data-testid="select-barcode-purpose">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="bin">Bin location</SelectItem>
                  <SelectItem value="finished_product">Finished product</SelectItem>
                  <SelectItem value="item">Item Inventory</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="sku"
          render={({ field }) => (
            <FormItem>
              <FormLabel>SKU (Optional)</FormLabel>
              <FormControl>
                <Input
                  placeholder="e.g., BIN-A1"
                  className="font-mono"
                  data-testid="input-barcode-sku"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={createBarcodeMutation.isPending}
            data-testid="button-save-barcode"
          >
            {createBarcodeMutation.isPending ? "Creating..." : "Create Barcode"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
