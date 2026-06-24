import { useState, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";

/**
 * Wraps the finance/compensation pages. The data is also gated server-side; this is the
 * UX layer. Until the session is unlocked with the FINANCE_PIN, the page is hidden.
 */
interface LockStatus { success: boolean; configured: boolean; unlocked: boolean }

export function FinanceGate({ children }: { children: ReactNode }) {
  const status = useQuery<LockStatus>({ queryKey: ["/api/finance-lock/status"] });
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");

  const unlock = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/finance-lock/unlock", { pin })).json(),
    onSuccess: (d: any) => {
      if (d?.success) { setErr(""); setPin(""); queryClient.invalidateQueries({ queryKey: ["/api/finance-lock/status"] }); }
      else setErr(d?.error || "Incorrect PIN");
    },
    onError: (e: any) => setErr(e?.message || "Incorrect PIN"),
  });

  if (status.isLoading) return <div className="p-6 text-sm text-muted-foreground">Checking access…</div>;
  if (status.data?.unlocked) return <>{children}</>;

  const configured = status.data?.configured;
  return (
    <div className="p-6 max-w-md mx-auto">
      <Card>
        <CardContent className="p-6 space-y-3">
          <div className="flex items-center gap-2 text-base font-semibold"><Lock className="h-4 w-4" /> Finances are locked</div>
          {configured ? (
            <>
              <p className="text-sm text-muted-foreground">This area shows financials and compensation. Enter the finance PIN to continue. It stays unlocked for the rest of this session.</p>
              <form onSubmit={(e) => { e.preventDefault(); if (pin) unlock.mutate(); }} className="space-y-2">
                <Input type="password" autoFocus value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Finance PIN" data-testid="finance-pin" />
                {err && <p className="text-xs text-red-600 dark:text-red-400" data-testid="finance-pin-error">{err}</p>}
                <Button type="submit" disabled={unlock.isPending || !pin} className="w-full" data-testid="finance-unlock">{unlock.isPending ? "Checking…" : "Unlock"}</Button>
              </form>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No finance PIN is set yet, so this area is locked for everyone. An owner needs to set <code className="rounded bg-muted px-1 text-xs">FINANCE_PIN</code> in Railway → SBR-App → Variables, then reload this page and enter it here.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
