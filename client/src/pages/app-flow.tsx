import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ShoppingCart, ArrowRight, Package, Users, Bell, Truck, FileText,
  ClipboardCheck, BarChart3, AlertTriangle, Mail, CheckCircle2,
  RefreshCw, TrendingDown, Calculator, ArrowDown, Send, Receipt,
  PackageOpen, RotateCcw, CreditCard, MessageSquare, Timer,
  Warehouse, GitBranch, Factory, Clipboard, Search, Database,
  Wrench, CircleDot, ArrowLeftRight
} from "lucide-react";

// Service logos as styled badges
function ServiceBadge({ name, color }: { name: string; color: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${color}`}>
      {name}
    </span>
  );
}

// Status indicator
function StatusDot({ status }: { status: "live" | "partial" | "planned" }) {
  const colors = {
    live: "bg-green-500",
    partial: "bg-yellow-500",
    planned: "bg-gray-400",
  };
  const labels = {
    live: "Live",
    partial: "Partial",
    planned: "Planned",
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={`h-2 w-2 rounded-full ${colors[status]}`} />
      {labels[status]}
    </span>
  );
}

// Individual step in a flow
function FlowStep({ icon: Icon, label, sublabel, service, isLast, status }: {
  icon: React.ElementType;
  label: string;
  sublabel?: string;
  service?: { name: string; color: string };
  isLast?: boolean;
  status?: "live" | "partial" | "planned";
}) {
  return (
    <div className="flex items-start gap-3 relative">
      {!isLast && (
        <div className="absolute left-[19px] top-[40px] w-0.5 h-[calc(100%-16px)] bg-border" />
      )}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary z-10">
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex-1 pb-6">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{label}</span>
          {service && <ServiceBadge name={service.name} color={service.color} />}
          {status && <StatusDot status={status} />}
        </div>
        {sublabel && <p className="text-xs text-muted-foreground mt-0.5">{sublabel}</p>}
      </div>
    </div>
  );
}

// Flow card wrapper
function FlowCard({ title, description, badge, statusBadge, children }: {
  title: string;
  description: string;
  badge?: { label: string; variant: "default" | "secondary" | "outline" | "destructive" };
  statusBadge?: "live" | "partial" | "planned";
  children: React.ReactNode;
}) {
  const statusColors = {
    live: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
    partial: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
    planned: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  };
  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <CardTitle className="text-lg">{title}</CardTitle>
          {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
          {statusBadge && (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[statusBadge]}`}>
              {statusBadge === "live" ? "Live" : statusBadge === "partial" ? "Partial" : "Planned"}
            </span>
          )}
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {children}
      </CardContent>
    </Card>
  );
}

const COLORS = {
  shopify: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  sbr: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  ghl: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  qb: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  extensiv: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  shippo: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  railway: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
};

export default function AppFlow() {
  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-semibold">App Flow</h1>
        <p className="text-sm text-muted-foreground">
          How the SBR inventory system actually works — updated March 2026
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Green = fully live · Yellow = partially working · Gray = planned / not yet connected
        </p>
      </div>

      {/* Integration Overview */}
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="py-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-center">
            <div className="flex flex-col items-center gap-1">
              <ServiceBadge name="Shopify" color={COLORS.shopify} />
              <StatusDot status="live" />
            </div>
            <div className="flex flex-col items-center gap-1">
              <ServiceBadge name="Extensiv 3PL" color={COLORS.extensiv} />
              <StatusDot status="partial" />
            </div>
            <div className="flex flex-col items-center gap-1">
              <ServiceBadge name="GoHighLevel" color={COLORS.ghl} />
              <StatusDot status="planned" />
            </div>
            <div className="flex flex-col items-center gap-1">
              <ServiceBadge name="QuickBooks" color={COLORS.qb} />
              <StatusDot status="planned" />
            </div>
            <div className="flex flex-col items-center gap-1">
              <ServiceBadge name="Shippo" color={COLORS.shippo} />
              <StatusDot status="planned" />
            </div>
            <div className="flex flex-col items-center gap-1">
              <ServiceBadge name="Railway DB" color={COLORS.railway} />
              <StatusDot status="live" />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* SALES ORDER FLOW */}
        <FlowCard
          title="Sales Order Flow"
          description="Shopify order → stock adjustment → BOM raw material subtraction"
          badge={{ label: "Automated", variant: "default" }}
          statusBadge="live"
        >
          <FlowStep
            icon={ShoppingCart}
            label="Order placed on Shopify"
            sublabel="Customer completes checkout"
            service={{ name: "Shopify", color: COLORS.shopify }}
            status="live"
          />
          <FlowStep
            icon={GitBranch}
            label="orders/create webhook fires"
            sublabel="Order synced to SalesOrders table in Railway DB"
            service={{ name: "SBR Inventory", color: COLORS.sbr }}
            status="live"
          />
          <FlowStep
            icon={Package}
            label="availableForSaleQty decremented"
            sublabel="Finished product stock reduced via InventoryMovement (SALES_ORDER_CREATED)"
            status="live"
          />
          <FlowStep
            icon={Truck}
            label="Order fulfilled → BOM subtraction"
            sublabel="orders/fulfilled webhook: raw materials subtracted based on Bill of Materials"
            service={{ name: "SBR Inventory", color: COLORS.sbr }}
            status="live"
          />
          <FlowStep
            icon={ArrowDown}
            label="Component currentStock reduced"
            sublabel="Each BOM component qty × units sold subtracted (BOM_CONSUMPTION event)"
            isLast
            status="live"
          />
        </FlowCard>

        {/* PRODUCTION FLOW */}
        <FlowCard
          title="Production Flow"
          description="Clarence builds products → raw materials consumed, finished goods added"
          badge={{ label: "Manual Entry", variant: "secondary" }}
          statusBadge="live"
        >
          <FlowStep
            icon={Factory}
            label="Clarence opens Production Screen"
            sublabel="Selects finished product, enters quantity built"
            status="live"
          />
          <FlowStep
            icon={Search}
            label="BOM lookup"
            sublabel="App reads Bill of Materials to find required components"
            status="live"
          />
          <FlowStep
            icon={AlertTriangle}
            label="Component stock check"
            sublabel="Verifies sufficient raw materials before proceeding"
            status="live"
          />
          <FlowStep
            icon={ArrowDown}
            label="Raw materials subtracted"
            sublabel="Each BOM component currentStock decremented (PRODUCE transaction)"
            status="live"
          />
          <FlowStep
            icon={CheckCircle2}
            label="hildaleQty incremented"
            sublabel="Finished goods added to Hildale warehouse (PRODUCTION_COMPLETED)"
            isLast
            status="live"
          />
        </FlowCard>

        {/* PURCHASE ORDER FLOW */}
        <FlowCard
          title="Purchase Order Flow"
          description="PO creation → supplier → receiving → auto stock update"
          badge={{ label: "Semi-Auto", variant: "secondary" }}
          statusBadge="live"
        >
          <FlowStep
            icon={FileText}
            label="PO created"
            sublabel="Generated manually or from AI restock recommendation"
            service={{ name: "SBR Inventory", color: COLORS.sbr }}
            status="live"
          />
          <FlowStep
            icon={Mail}
            label="PO emailed to supplier"
            sublabel="PDF generated and sent via app"
            status="live"
          />
          <FlowStep
            icon={ClipboardCheck}
            label="Supplier acknowledges"
            sublabel="Supplier clicks approve link in email"
            status="live"
          />
          <FlowStep
            icon={Truck}
            label="Goods arrive at warehouse"
            sublabel="Physical delivery received"
          />
          <FlowStep
            icon={CheckCircle2}
            label="PO marked Received → auto stock update"
            sublabel="PURCHASE_ORDER_RECEIVED increments component currentStock automatically"
            isLast
            status="live"
          />
        </FlowCard>

        {/* EXTENSIV SYNC */}
        <FlowCard
          title="Extensiv 3PL Sync"
          description="Pivot warehouse quantities pulled from Extensiv into Railway DB"
          badge={{ label: "Hourly Cron", variant: "outline" }}
          statusBadge="partial"
        >
          <FlowStep
            icon={RefreshCw}
            label="Cron job fires (extensiv-sync.js)"
            sublabel="Runs hourly via Railway Cron — or manually: npm run sync:extensiv"
            service={{ name: "Railway", color: COLORS.railway }}
            status="live"
          />
          <FlowStep
            icon={Database}
            label="OAuth2 token obtained"
            sublabel="Authenticates with Extensiv API using client credentials"
            service={{ name: "Extensiv 3PL", color: COLORS.extensiv }}
            status="partial"
          />
          <FlowStep
            icon={Package}
            label="Stock summary fetched"
            sublabel="All SKU quantities (on-hand, allocated, available) pulled"
            status="partial"
          />
          <FlowStep
            icon={ArrowLeftRight}
            label="SKU matching"
            sublabel="Matches by extensiv_sku column, falls back to house SKU"
          />
          <FlowStep
            icon={CheckCircle2}
            label="pivotQty + snapshot updated"
            sublabel="EXTENSIV_SYNC is the ONLY event that writes pivotQty (read-only otherwise)"
            isLast
            status="partial"
          />
        </FlowCard>

        {/* MANUAL COUNT FLOW */}
        <FlowCard
          title="Weekly Physical Count"
          description="Sammie counts finished goods, Clarence counts raw materials"
          badge={{ label: "Weekly", variant: "outline" }}
          statusBadge="live"
        >
          <FlowStep
            icon={Clipboard}
            label="Count submitted"
            sublabel="POST /api/inventory-adjustments with itemId, actualQty, submittedBy"
            status="live"
          />
          <FlowStep
            icon={Calculator}
            label="Difference auto-calculated"
            sublabel="App reads current stock as expected, computes difference = actual - expected"
            status="live"
          />
          <FlowStep
            icon={Wrench}
            label="Stock auto-adjusted"
            sublabel="InventoryMovement (MANUAL_COUNT) applies the delta to live inventory"
            status="live"
          />
          <FlowStep
            icon={ClipboardCheck}
            label="Adjustment logged"
            sublabel="Saved to inventory_adjustments table with submitter and timestamp"
            isLast
            status="live"
          />
        </FlowCard>

        {/* RETURNS FLOW */}
        <FlowCard
          title="Returns Flow"
          description="Customer return → inspection → restock or dispose"
          badge={{ label: "Multi-Channel", variant: "secondary" }}
          statusBadge="live"
        >
          <FlowStep
            icon={MessageSquare}
            label="Return requested"
            sublabel="Via GHL conversation, Shopify, or manual entry"
            status="live"
          />
          <FlowStep
            icon={PackageOpen}
            label="Return created in SBR"
            sublabel="Return record with RMA number, reason, customer info"
            service={{ name: "SBR Inventory", color: COLORS.sbr }}
            status="live"
          />
          <FlowStep
            icon={Warehouse}
            label="Product received and inspected"
            sublabel="Damage assessment: resellable, refurb, or dispose"
            status="live"
          />
          <FlowStep
            icon={CheckCircle2}
            label="hildaleQty incremented (if resellable)"
            sublabel="RETURN_RECEIVED adds stock back to Hildale for processing"
            isLast
            status="live"
          />
        </FlowCard>

        {/* AI MONITORING */}
        <FlowCard
          title="Inventory Monitoring + AI"
          description="Automatic stock tracking and AI-powered reorder recommendations"
          badge={{ label: "Scheduled", variant: "outline" }}
          statusBadge="partial"
        >
          <FlowStep
            icon={BarChart3}
            label="AI agent runs on schedule"
            sublabel="10AM and 3PM Mountain — analyzes stock levels and velocity"
            status="partial"
          />
          <FlowStep
            icon={TrendingDown}
            label="Low stock items identified"
            sublabel="Items at or below min_stock threshold flagged"
            status="live"
          />
          <FlowStep
            icon={Calculator}
            label="Reorder recommendation generated"
            sublabel="AI suggests PO quantities based on usage and lead times"
            status="partial"
          />
          <FlowStep
            icon={Bell}
            label="Alert sent to team"
            sublabel="Via GHL (when configured) or in-app notification"
            isLast
            status="planned"
          />
        </FlowCard>

        {/* DATA RESPONSIBILITY */}
        <FlowCard
          title="Who Enters What"
          description="Data responsibility matrix — who is responsible for each input"
          badge={{ label: "Reference", variant: "outline" }}
        >
          <FlowStep
            icon={ShoppingCart}
            label="Sales Orders → Automatic"
            sublabel="Shopify webhooks fire on every order — no human action"
            service={{ name: "Shopify", color: COLORS.shopify }}
            status="live"
          />
          <FlowStep
            icon={Factory}
            label="Production Log → Clarence"
            sublabel="Every production run via Production Screen"
            status="live"
          />
          <FlowStep
            icon={Clipboard}
            label="Raw Material Counts → Clarence (weekly)"
            sublabel="Physical count submitted via inventory adjustments API"
            status="live"
          />
          <FlowStep
            icon={Clipboard}
            label="Finished Goods Counts → Sammie (weekly)"
            sublabel="Physical count submitted via inventory adjustments API"
            status="live"
          />
          <FlowStep
            icon={FileText}
            label="Purchase Orders → Matt / Ops"
            sublabel="Created when ordering from suppliers"
            status="live"
          />
          <FlowStep
            icon={RefreshCw}
            label="Extensiv Sync → Automatic (hourly)"
            sublabel="Cron job pulls Pivot warehouse quantities"
            isLast
            status="partial"
          />
        </FlowCard>
      </div>
    </div>
  );
}
