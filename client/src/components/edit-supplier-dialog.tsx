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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Supplier } from "@shared/schema";

const supplierFormSchema = z.object({
  name: z.string().min(1, "Supplier name is required"),
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

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <ScrollArea className="max-h-[60vh] pr-4">
              <div className="grid gap-4 py-4">
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
                onClick={() => onOpenChange(false)}
                disabled={updateMutation.isPending}
                data-testid="button-cancel"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={updateMutation.isPending}
                data-testid="button-save-supplier"
              >
                {updateMutation.isPending ? (
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
      </DialogContent>
    </Dialog>
  );
}
