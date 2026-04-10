import { Package, Barcode, Brain, Settings, Building2, PackageOpen, ShoppingCart, ClipboardList, BarChart3, Workflow, Factory, ClipboardCheck, PackageCheck, Megaphone, Warehouse, Boxes, Truck } from "lucide-react";
import { Link, useLocation } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";

// Sidebar items organized into logical groups so the list stays
// scannable even on smaller screens.  Each group gets its own label.
const overviewItems = [
  { title: "Reports",    url: "/",            icon: BarChart3  },
  { title: "Inventory",  url: "/inventory",   icon: Warehouse  },
  { title: "Marketing",  url: "/marketing",   icon: Megaphone  },
];

const operationsItems = [
  { title: "Products",           url: "/products",           icon: Package  },
  { title: "Raw Materials",      url: "/raw-materials",      icon: Boxes    },
  { title: "Production",         url: "/production",         icon: Factory  },
  { title: "In-House Shipping",  url: "/in-house-shipping",  icon: Truck    },
  { title: "Barcodes",           url: "/barcodes",           icon: Barcode  },
];

const orderItems = [
  { title: "Suppliers",        url: "/suppliers",        icon: Building2     },
  { title: "Purchase Orders",  url: "/purchase-orders",  icon: ClipboardList },
  { title: "Sales Orders",     url: "/sales-orders",     icon: ShoppingCart  },
  { title: "Returns",          url: "/returns",          icon: PackageOpen   },
];

const toolItems = [
  { title: "AI Agent",  url: "/ai",        icon: Brain    },
  { title: "App Flow",  url: "/app-flow",  icon: Workflow },
];

export function AppSidebar() {
  const [location] = useLocation();

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
          { label: "Overview",   items: overviewItems   },
          { label: "Operations", items: operationsItems },
          { label: "Orders",     items: orderItems      },
          { label: "Tools",      items: toolItems       },
        ].map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const isActive = location === item.url;
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild isActive={isActive}>
                        <Link href={item.url} data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
                          <item.icon className="h-5 w-5" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
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
