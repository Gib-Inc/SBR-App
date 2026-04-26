import { Switch, Route, useLocation, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { AuthProvider, useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { User, LogOut } from "lucide-react";
import { NotificationsBell } from "@/components/notifications-bell";
import { ScanProvider } from "@/contexts/scan-context";
import { ScanButton } from "@/components/scan-button";
import { SyncProgressPanel } from "@/components/sync-progress-panel";
import Products from "@/pages/products";
import Production from "@/pages/production";
import CycleCount from "@/pages/cycle-count";
import DirectOrders from "@/pages/direct-orders";
import Barcodes from "@/pages/barcodes";
import AIAgent from "@/pages/ai";
import AppFlow from "@/pages/app-flow";
import Settings from "@/pages/settings";
import Suppliers from "@/pages/suppliers";
import SalesOrders from "@/pages/sales-orders";
import PurchaseOrders from "@/pages/purchase-orders";
import Returns from "@/pages/returns";
import Login from "@/pages/login";
import POAcknowledge from "@/pages/po-acknowledge";
import Reports from "@/pages/reports";
import NotFound from "@/pages/not-found";
import LegalEULA from "@/pages/legal-eula";
import LegalPrivacy from "@/pages/legal-privacy";
import AcceptInvite from "@/pages/accept-invite";
import ResetPassword from "@/pages/reset-password";
import Marketing from "@/pages/marketing";
import Inventory from "@/pages/inventory";
import RawMaterials from "@/pages/raw-materials";
import CountInventory from "@/pages/count-inventory";
import ReceiveStock from "@/pages/receive-stock";
import Backorders from "@/pages/backorders";
import InHouseShipping from "@/pages/in-house-shipping";
import Scan from "@/pages/scan";
import SupplierIntel from "@/pages/supplier-intel";

function UserMenu() {
  const { user, logout } = useAuth();

  if (!user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" data-testid="button-user-menu">
          <User className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">Account</p>
            <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={logout} data-testid="button-logout">
          <LogOut className="mr-2 h-4 w-4" />
          <span>Log out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AuthenticatedApp() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <div className="text-lg font-medium">Loading...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <Switch>
      <Route path="/login">
        <Redirect to="/" />
      </Route>
      <Route path="/scan" component={Scan} />
      <Route>
        {() => (
          <SidebarProvider
            style={
              {
                "--sidebar-width": "16rem",
                "--sidebar-width-icon": "3rem",
              } as React.CSSProperties
            }
          >
            <div className="flex h-screen w-full">
              <AppSidebar />
              <div className="flex flex-1 flex-col min-w-0">
                <header className="flex h-14 items-center justify-between gap-4 border-b px-4">
                  <SidebarTrigger data-testid="button-sidebar-toggle" />
                  <div className="flex items-center gap-2">
                    <ScanButton />
                    <ThemeToggle />
                    <NotificationsBell />
                    <UserMenu />
                  </div>
                </header>
                <main className="flex-1 overflow-y-auto overflow-x-hidden min-w-0">
                  <Switch>
                    <Route path="/" component={Reports} />
                    <Route path="/products" component={Products} />
                    <Route path="/production" component={Production} />
                    <Route path="/cycle-count" component={CycleCount} />
                    <Route path="/direct-orders" component={DirectOrders} />
                    <Route path="/barcodes" component={Barcodes} />
                    <Route path="/suppliers" component={Suppliers} />
                    <Route path="/supplier-intel" component={SupplierIntel} />
                    <Route path="/purchase-orders" component={PurchaseOrders} />
                    <Route path="/sales-orders" component={SalesOrders} />
                    <Route path="/backorders" component={Backorders} />
                    <Route path="/returns" component={Returns} />
                    <Route path="/ai" component={AIAgent} />
                    <Route path="/marketing" component={Marketing} />
                    <Route path="/inventory" component={Inventory} />
                    <Route path="/raw-materials" component={RawMaterials} />
                    <Route path="/count-inventory" component={CountInventory} />
                    <Route path="/receive-stock" component={ReceiveStock} />
                    <Route path="/in-house-shipping" component={InHouseShipping} />
                    <Route path="/app-flow" component={AppFlow} />
                    <Route path="/settings" component={Settings} />
                    <Route component={NotFound} />
                  </Switch>
                </main>
              </div>
            </div>
          </SidebarProvider>
        )}
      </Route>
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Switch>
          <Route path="/po/acknowledge/:token" component={POAcknowledge} />
          <Route path="/invite/:token" component={AcceptInvite} />
          <Route path="/reset-password/:token" component={ResetPassword} />
          <Route path="/legal/eula" component={LegalEULA} />
          <Route path="/legal/privacy" component={LegalPrivacy} />
          <Route>
            <AuthProvider>
              <ScanProvider>
                <AuthenticatedApp />
                <SyncProgressPanel />
              </ScanProvider>
            </AuthProvider>
          </Route>
        </Switch>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
// force rebuild Thu Apr  2 19:23:04 MDT 2026
// force rebuild Thu Apr  2 19:23:40 MDT 2026
