import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Package, Loader2 } from "lucide-react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingSetup, setIsCheckingSetup] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const { login } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    fetch("/api/auth/setup-status")
      .then(res => res.json())
      .then(data => setNeedsSetup(data.needsSetup))
      .catch(() => setNeedsSetup(false))
      .finally(() => setIsCheckingSetup(false));
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await login(email, password);
      toast({ title: "Welcome back!", description: "You have successfully logged in" });
    } catch (error: any) {
      toast({ title: "Login failed", description: error.message || "Invalid email or password", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    if (password.length < 8) {
      toast({ title: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Setup failed");
      }
      toast({ title: "Admin account created!", description: "Redirecting to dashboard..." });
      window.location.href = "/";
    } catch (error: any) {
      toast({ title: "Setup failed", description: error.message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  if (isCheckingSetup) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary">
            <Package className="h-6 w-6 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl">
            {needsSetup ? "Welcome to SBR Inventory" : "Inventory Management"}
          </CardTitle>
          <CardDescription>
            {needsSetup
              ? "Create your admin account to get started"
              : "Sign in to access your inventory system"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {needsSetup ? (
            <form onSubmit={handleSetup} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Admin Email</Label>
                <Input
                  id="email" type="email" placeholder="you@company.com"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  required autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password" type="password" placeholder="At least 8 characters"
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  required autoComplete="new-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword" type="password" placeholder="Confirm your password"
                  value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                  required autoComplete="new-password"
                />
              </div>
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Creating account..." : "Create Admin Account"}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email" type="email" placeholder="Enter your email"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  required autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password" type="password" placeholder="Enter your password"
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  required autoComplete="current-password"
                />
              </div>
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Signing in..." : "Sign In"}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Need access? Ask your admin to send you an invite.
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
