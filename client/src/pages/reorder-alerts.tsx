import { useMutation, useQuery } from "@tanstack/react-query";
import { BellRing, Loader2, PackageCheck, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { ReorderDigestCard } from "@/components/reorder-digest-card";

export default function ReorderAlerts() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "owner";

  const { data: settings } = useQuery<{ paused: boolean }>({
    queryKey: ["/api/reorder-alerts/settings"],
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/reorder/needs"] });
    queryClient.invalidateQueries({ queryKey: ["/api/reorder-alerts/settings"] });
  };

  const pauseMutation = useMutation({
    mutationFn: async (paused: boolean) => (await apiRequest("PATCH", "/api/reorder-alerts/settings", { paused })).json(),
    onSuccess: refresh,
    onError: (error: Error) => toast({ title: "Failed to update auto-send pause", description: error.message, variant: "destructive" }),
  });

  // Group everything needing reorder (PO vendors only — online vendors are bought
  // on a website) into per-vendor DRAFT purchase orders, reviewed on the PO page.
  const autoDraftMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/purchase-orders/auto-draft", {})).json(),
    onSuccess: (result: any) => {
      const created = result?.created?.length ?? 0;
      const exists = result?.alreadyExists?.length ?? 0;
      const skipped = result?.skipped?.length ?? 0;
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      toast({
        title: created > 0 ? `Created ${created} draft PO${created === 1 ? "" : "s"}` : "No new draft POs needed",
        description:
          [
            created > 0 ? `${created} created` : null,
            exists > 0 ? `${exists} already drafted today` : null,
            skipped > 0 ? `${skipped} skipped (missing supplier/cost)` : null,
          ].filter(Boolean).join(" · ") || "Everything needing reorder is already drafted.",
      });
    },
    onError: (error: Error) => toast({ title: "Draft PO generation failed", description: error.message, variant: "destructive" }),
  });

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Reorder</h1>
          <p className="text-sm text-muted-foreground">
            What to order this week, per vendor — live velocity × BOM, seasonally adjusted. Online suppliers link out to buy; PO vendors draft a PO.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => autoDraftMutation.mutate()} disabled={autoDraftMutation.isPending || !isAdmin}>
            {autoDraftMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackageCheck className="mr-2 h-4 w-4" />}
            Generate Draft POs
          </Button>
        </div>
      </div>

      {/* The live reorder engine — deduplicated by design, PO vs buy-online aware. */}
      <ReorderDigestCard live />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><BellRing className="h-4 w-4" /> Pause auto-send emails</CardTitle>
            <CardDescription>
              When off, the watcher can email POs to vendors automatically. Default is paused — you review and send.
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={settings?.paused ? "secondary" : "default"}>{settings?.paused ? "Paused" : "Active"}</Badge>
            <Switch
              checked={settings?.paused ?? true}
              disabled={!isAdmin || pauseMutation.isPending}
              onCheckedChange={(checked) => pauseMutation.mutate(checked)}
              aria-label="Pause all auto-sends"
            />
          </div>
        </CardHeader>
      </Card>
    </div>
  );
}
