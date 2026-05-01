import { Package, Barcode, Brain, Settings, Building2, PackageOpen, ShoppingCart, ClipboardList, BarChart3, Workflow, Factory, ClipboardCheck, PackageCheck, Megaphone, Warehouse, Boxes, Truck, ListChecks, PackagePlus, ListOrdered, Link2 } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuBadge,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";

// ── Sidebar groups ──────────────────────────────────────────
// Organized by workflow: Dashboard → Sales & Fulfillment → Supply Chain → Tools
// Sales & Fulfillment = Sammie's daily workflow (orders in → ship → returns)
// Supply Chain = sourcing, production, and product catalog

const dashboardItems = [
  { title: "Reports",    url: "/",            icon: BarChart3  },
  { title: "Inventory",  url: "/inventory",   icon: Warehouse  },
];

const salesItems = [
  { title: "Sales Orders",      url: "/sales-orders",       icon: ShoppingCart  },
  { title: "Backorders",        url: "/backorders",         icon: PackageCheck  },
  { title: "Production Priority", url: "/production-priority", icon: ListOrdered  },
  { title: "In-House Shipping", url: "/in-house-shipping",  icon: Truck         },
  { title: "Returns",           url: "/returns",            icon: PackageOpen   },
];

const supplyChainItems = [
  { title: "Products",         url: "/products",         icon: Package       },
  { title: "Raw Materials",    url: "/raw-materials",    icon: Boxes         },
  { title: "Count Inventory",  url: "/count-inventory",  icon: ListChecks    },
  { title: "Production",       url: "/production",       icon: Factory       },
  { title: "Receive Stock",    url: "/receive-stock",    icon: PackagePlus   },
  { title: "Incoming",         url: "/incoming",         icon: Truck         },
  { title: "Purchase Orders",  url: "/purchase-orders",  icon: ClipboardList },
  { title: "Suppliers",        url: "/suppliers",        icon: Building2     },
  { title: "Supplier Intel",   url: "/supplier-intel",   icon: ClipboardCheck },
];

const toolItems = [
  { title: "Barcodes",   url: "/barcodes",   icon: Barcode  },
  { title: "SKU Mappings", url: "/sku-mappings", icon: Link2 },
  { title: "Marketing",  url: "/marketing",  icon: Megaphone },
  { title: "AI Agent",   url: "/ai",         icon: Brain    },
  { title: "App Flow",   url: "/app-flow",   icon: Workflow },
];

export function AppSidebar() {
  const [location] = useLocation();

  // Live count of in-house orders waiting to ship (refreshes every 60s)
  const { data: inHouseData } = useQuery<{ summary: { total: number } }>({
    queryKey: ["/api/sales-orders/in-house"],
    refetchInterval: 60_000,
  });
  const inHouseCount = inHouseData?.summary?.total ?? 0;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-6 pb-4">
        <div className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary group-data-[collapsible=icon]:mx-auto">
            <Package className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="flex flex-col group-data-[collapsible=icon]:hidden">
            <span className="text-lg font-semibold">SBR</span>
            <span className="text-xs text-muted-foreground">Inventory Management</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {/* Helper that renders a group of sidebar links */}
        {[
          { label: "Dashboard",          items: dashboardItems    },
          { label: "Sales & Fulfillment", items: salesItems       },
          { label: "Supply Chain",        items: supplyChainItems },
          { label: "Tools",               items: toolItems        },
        ].map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const isActive = location === item.url;
                  const badgeCount = item.url === "/in-house-shipping" ? inHouseCount : 0;
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild isActive={isActive}>
                        <Link href={item.url} data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
                          <item.icon className="h-5 w-5" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                      {badgeCount > 0 && (
                        <SidebarMenuBadge className="bg-destructive text-destructive-foreground">
                          {badgeCount}
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={location === "/settings"}>
              <Link href="/settings" data-testid="link-settings">
                <Settings className="h-5 w-5" />
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
