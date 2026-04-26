import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Save, Building2, ShoppingBag, Wrench } from "lucide-react";
import { SupplierPerformance } from "@/components/supplier-performance";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Supplier } from "@shared/schema";

const supplierFormSchema = z.object({
  name: z.string().min(1, "Supplier name is required"),
  supplierType: z.enum(["supplier", "private", "online"]).default("supplier"),
  contactName: z.string().optional().nullable(),
  email: z.string().email("Invalid email format").optional().or(z.literal("")),
  phone: z.string().optional().nullable(),
  streetAddress: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  stateRegion: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  paymentTerms: z.string().optional().nullable(),
  catalogUrl: z.string().optional().nullable(),
});

type SupplierFormData = z.infer<typeof supplierFormSchema>;

interface EditSupplierDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplier: Supplier | null;
  mode: "edit" | "create";
  onSaved?: (supplier: Supplier) => void;
}

export function EditSupplierDialog({
  open,
  onOpenChange,
  supplier,
  mode,
  onSaved,
}: EditSupplierDialogProps) {
  const { toast } = useToast();

  const form = useForm<SupplierFormData>({
    resolver: zodResolver(supplierFormSchema),
    defaultValues: {
      name: "",
      supplierType: "supplier",
      contactName: "",
      email: "",
      phone: "",
      streetAddress: "",
      city: "",
      stateRegion: "",
      postalCode: "",
      country: "",
      notes: "",
      paymentTerms: "",
      catalogUrl: "",
    },
  });

  useEffect(() => {
    if (open && supplier && mode === "edit") {
      form.reset({
        name: supplier.name || "",
        supplierType: (supplier as any).supplierType || "supplier",
        contactName: supplier.contactName || "",
        email: supplier.email || "",
        phone: supplier.phone || "",
        streetAddress: supplier.streetAddress || "",
        city: supplier.city || "",
        stateRegion: supplier.stateRegion || "",
        postalCode: supplier.postalCode || "",
        country: supplier.country || "",
        notes: supplier.notes || "",
        paymentTerms: supplier.paymentTerms || "",
        catalogUrl: supplier.catalogUrl || "",
      });
    } else if (open && mode === "create") {
      form.reset({
        name: "",
        supplierType: "supplier",
        contactName: "",
        email: "",
        phone: "",
        streetAddress: "",
        city: "",
        stateRegion: "",
        postalCode: "",
        country: "",
        notes: "",
        paymentTerms: "",
        catalogUrl: "",
      });
    }
  }, [open, supplier, mode, form]);

  const updateMutation = useMutation({
    mutationFn: async (data: SupplierFormData) => {
      // Clean up empty strings to null for optional fields
      const cleanedData = {
        ...data,
        supplierType: data.supplierType || "supplier",
        contactName: data.contactName || null,
        email: data.email || null,
        phone: data.phone || null,
        streetAddress: data.streetAddress || null,
        city: data.city || null,
        stateRegion: data.stateRegion || null,
        postalCode: data.postalCode || null,
        country: data.country || null,
        notes: data.notes || null,
        paymentTerms: data.paymentTerms || null,
        catalogUrl: data.catalogUrl || null,
      };
      
      if (mode === "edit" && supplier) {
        const res = await apiRequest("PATCH", `/api/suppliers/${supplier.id}`, cleanedData);
        return res.json();
      } else {
        const res = await apiRequest("POST", "/api/suppliers", cleanedData);
        return res.json();
      }
    },
    onSuccess: (savedSupplier) => {
      queryClient.invalidateQueries({ queryKey: ['/api/suppliers'] });
      toast({
        title: mode === "edit" ? "Supplier updated" : "Supplier created",
        description: `${savedSupplier.name} has been ${mode === "edit" ? "updated" : "created"} successfully.`,
      });
      onSaved?.(savedSupplier);
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || `Failed to ${mode} supplier`,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: SupplierFormData) => {
    updateMutation.mutate(data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh]" data-testid="dialog-edit-supplier">
        <DialogHeader>
          <DialogTitle data-testid="text-dialog-title">
            {mode === "edit" ? "Edit Supplier" : "Add Supplier"}
          </DialogTitle>
          <DialogDescription>
            {mode === "edit"
              ? "Update supplier information. Changes will apply to new purchase orders."
              : "Add a new supplier to your system."}
          </DialogDescription>
        </DialogHeader>

        {mode === "edit" && supplier ? (
          <Tabs defaultValue="details" className="w-full">
            <TabsList className="grid w-full max-w-sm grid-cols-2">
              <TabsTrigger value="details" data-testid="tab-supplier-details">Details</TabsTrigger>
              <TabsTrigger value="performance" data-testid="tab-supplier-performance">Performance</TabsTrigger>
            </TabsList>
            <TabsContent value="performance" className="mt-4 max-h-[60vh] overflow-y-auto">
              <SupplierPerformance supplierId={supplier.id} />
            </TabsContent>
            <TabsContent value="details" className="mt-4">
              <SupplierFormBody form={form} onSubmit={onSubmit} mutationPending={updateMutation.isPending} mode={mode} onClose={() => onOpenChange(false)} />
            </TabsContent>
          </Tabs>
        ) : (
          <SupplierFormBody form={form} onSubmit={onSubmit} mutationPending={updateMutation.isPending} mode={mode} onClose={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

// Form body extracted so the edit-mode tabs and the add-mode flat layout
// share the same fields without duplication.
function SupplierFormBody({
  form,
  onSubmit,
  mutationPending,
  mode,
  onClose,
}: {
  form: ReturnType<typeof useForm<SupplierFormData>>;
  onSubmit: (values: SupplierFormData) => void;
  mutationPending: boolean;
  mode: "edit" | "create";
  onClose: () => void;
}) {
  return (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <ScrollArea className="max-h-[60vh] pr-4">
              <div className="grid gap-4 py-4">
                {/* Supplier Type Selector */}
                <FormField
                  control={form.control}
                  name="supplierType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Supplier Type <span className="text-destructive">*</span>
                      </FormLabel>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { value: "supplier", label: "Supplier", desc: "Standard PO & invoicing", icon: Building2, hint: "Net 30 terms, they bill you" },
                          { value: "online", label: "Online Source", desc: "Amazon, retail stores", icon: ShoppingBag, hint: "Paid at purchase, upload receipt" },
                          { value: "private", label: "Private Source", desc: "Contractors, freelancers", icon: Wrench, hint: "Pay by check on delivery" },
                        ].map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => field.onChange(opt.value)}
                            className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-all text-center ${
                              field.value === opt.value
                                ? "border-primary bg-primary/5"
                                : "border-border hover:border-muted-foreground/30"
                            }`}
                          >
                            <opt.icon className={`h-5 w-5 ${field.value === opt.value ? "text-primary" : "text-muted-foreground"}`} />
                            <span className="font-medium text-sm">{opt.label}</span>
                            <span className="text-[11px] text-muted-foreground leading-tight">{opt.hint}</span>
                          </button>
                        ))}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Supplier Name <span className="text-destructive">*</span>
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="e.g., Acme Corp"
                            data-testid="input-supplier-name"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="contactName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contact Name</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            value={field.value || ""}
                            placeholder="e.g., John Smith"
                            data-testid="input-contact-name"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="email"
                            value={field.value || ""}
                            placeholder="e.g., contact@supplier.com"
                            data-testid="input-supplier-email"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            value={field.value || ""}
                            placeholder="e.g., (555) 123-4567"
                            data-testid="input-supplier-phone"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="streetAddress"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Street Address</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value || ""}
                          placeholder="e.g., 123 Main Street"
                          data-testid="input-street-address"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="city"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>City</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            value={field.value || ""}
                            placeholder="e.g., New York"
                            data-testid="input-city"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="stateRegion"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>State / Region</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            value={field.value || ""}
                            placeholder="e.g., NY"
                            data-testid="input-state-region"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="postalCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Postal Code</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            value={field.value || ""}
                            placeholder="e.g., 10001"
                            data-testid="input-postal-code"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="country"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Country</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            value={field.value || ""}
                            placeholder="e.g., United States"
                            data-testid="input-country"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="paymentTerms"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Payment Terms</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value || ""}
                          placeholder="e.g., Net 30"
                          data-testid="input-payment-terms"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="catalogUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Catalog URL</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value || ""}
                          placeholder="e.g., https://supplier.com/catalog"
                          data-testid="input-catalog-url"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          value={field.value || ""}
                          placeholder="Additional notes about this supplier..."
                          rows={3}
                          data-testid="input-notes"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </ScrollArea>

            <DialogFooter className="gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={mutationPending}
                data-testid="button-cancel"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={mutationPending}
                data-testid="button-save-supplier"
              >
                {mutationPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    {mode === "edit" ? "Save Changes" : "Create Supplier"}
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
  );
}
