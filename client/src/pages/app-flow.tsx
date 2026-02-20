import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ShoppingCart, ArrowRight, Package, Users, Bell, Truck, FileText,
  ClipboardCheck, BarChart3, AlertTriangle, Mail, CheckCircle2,
  RefreshCw, TrendingDown, Calculator, ArrowDown, Send, Receipt,
  PackageOpen, RotateCcw, CreditCard, MessageSquare, Timer,
  Warehouse, GitBranch
} from "lucide-react";

// Service logos as styled badges
function ServiceBadge({ name, color }: { name: string; color: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${color}`}>
      {name}
    </span>
  );
}

// Individual step in a flow
function FlowStep({ icon: Icon, label, sublabel, service, isLast }: {
  icon: React.ElementType;
  label: string;
  sublabel?: string;
  service?: { name: string; color: string };
  isLast?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 relative">
      {/* Vertical connector line */}
      {!isLast && (
        <div className="absolute left-[19px] top-[40px] w-0.5 h-[calc(100%-16px)] bg-border" />
      )}
      {/* Icon */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary z-10">
        <Icon className="h-5 w-5" />
      </div>
      {/* Content */}
      <div className="flex-1 pb-6">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{label}</span>
          {service && <ServiceBadge name={service.name} color={service.color} />}
        </div>
        {sublabel && <p className="text-xs text-muted-foreground mt-0.5">{sublabel}</p>}
      </div>
    </div>
  );
}

// Flow card wrapper
function FlowCard({ title, description, badge, children }: {
  title: string;
  description: string;
  badge?: { label: string; variant: "default" | "secondary" | "outline" | "destructive" };
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <CardTitle className="text-lg">{title}</CardTitle>
          {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {children}
      </CardContent>
    </Card>
  );
}

export default function AppFlow() {
  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-semibold">App Flow</h1>
        <p className="text-sm text-muted-foreground">
          How your inventory system connects Shopify, GoHighLevel, suppliers, and warehouse operations
        </p>
      </div>

      {/* Integration Overview */}
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="py-5">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <ServiceBadge name="Shopify" color="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" />
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <ServiceBadge name="SBR Inventory" color="bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" />
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <ServiceBadge name="GoHighLevel" color="bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300" />
            <span className="text-muted-foreground text-xs mx-1">+</span>
            <ServiceBadge name="QuickBooks" color="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" />
            <span className="text-muted-foreground text-xs mx-1">+</span>
            <ServiceBadge name="Extensiv 3PL" color="bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300" />
            <span className="text-muted-foreground text-xs mx-1">+</span>
            <ServiceBadge name="Shippo" color="bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300" />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ─────────── SALES ORDER FLOW ─────────── */}
        <FlowCard
          title="Sales Order Flow"
          description="From Shopify purchase to fulfillment tracking"
          badge={{ label: "Automated", variant: "default" }}
        >
          <FlowStep
            icon={ShoppingCart}
            label="New order placed"
            sublabel="Customer completes checkout"
            service={{ name: "Shopify", color: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" }}
          />
          <FlowStep
            icon={GitBranch}
            label="Webhook received"
            sublabel="Order data synced to SBR Inventory in real-time"
            service={{ name: "SBR Inventory", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" }}
          />
          <FlowStep
            icon={Package}
            label="Available stock adjusted"
            sublabel="Product quantities decremented, inventory updated"
          />
          <FlowStep
            icon={Users}
            label="Contact created / updated"
            sublabel="Customer synced with order history and timeline"
            service={{ name: "GoHighLevel", color: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300" }}
          />
          <FlowStep
            icon={Timer}
            label="Fulfillment timer starts"
            sublabel="Time tracked from order to ship for performance metrics"
          />
          <FlowStep
            icon={Truck}
            label="Shipping label generated"
            sublabel="Label created and tracking number assigned"
            service={{ name: "Shippo", color: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300" }}
            isLast
          />
        </FlowCard>

        {/* ─────────── PURCHASE ORDER FLOW ─────────── */}
        <FlowCard
          title="Purchase Order Flow"
          description="From PO creation to stock replenishment"
          badge={{ label: "Semi-Auto", variant: "secondary" }}
        >
          <FlowStep
            icon={FileText}
            label="PO created"
            sublabel="Generated manually or by AI restock recommendation"
            service={{ name: "SBR Inventory", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" }}
          />
          <FlowStep
            icon={Mail}
            label="PO emailed to supplier"
            sublabel="Supplier receives PO with line items and delivery instructions"
            service={{ name: "SendGrid", color: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300" }}
          />
          <FlowStep
            icon={ClipboardCheck}
            label="Supplier acknowledges"
            sublabel="Supplier clicks approve link, confirms availability and timeline"
          />
          <FlowStep
            icon={Receipt}
            label="Invoice sent"
            sublabel="Synced with accounting for payment tracking"
            service={{ name: "QuickBooks", color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" }}
          />
          <FlowStep
            icon={Truck}
            label="Product arrives at warehouse"
            sublabel="Delivery received and items inspected"
          />
          <FlowStep
            icon={CheckCircle2}
            label="Stock adjusted"
            sublabel="Inventory quantities updated, PO marked received"
            isLast
          />
        </FlowCard>

        {/* ─────────── INVENTORY MONITORING FLOW ─────────── */}
        <FlowCard
          title="Inventory Monitoring"
          description="Automatic stock level tracking and low-stock alerts"
          badge={{ label: "Always On", variant: "default" }}
        >
          <FlowStep
            icon={ShoppingCart}
            label="Sales come in"
            sublabel="Each order reduces available finished product stock"
            service={{ name: "Shopify", color: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" }}
          />
          <FlowStep
            icon={Package}
            label="Available stock adjusted"
            sublabel="Real-time inventory count updated per SKU"
          />
          <FlowStep
            icon={Calculator}
            label="Consumption projection calculated"
            sublabel="AI analyzes sales velocity × BOM to forecast component burn rate"
          />
          <FlowStep
            icon={TrendingDown}
            label="Low stock identified"
            sublabel="Items falling below minimum threshold flagged"
          />
          <FlowStep
            icon={AlertTriangle}
            label="Alert sent"
            sublabel="Notification pushed to team with restock recommendation"
            service={{ name: "GoHighLevel", color: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300" }}
          />
          <FlowStep
            icon={FileText}
            label="Auto-PO recommendation"
            sublabel="AI suggests purchase order with optimal quantities and supplier"
            isLast
          />
        </FlowCard>

        {/* ─────────── RETURNS FLOW ─────────── */}
        <FlowCard
          title="Returns & Refund Flow"
          description="Customer return processing from request to resolution"
          badge={{ label: "Multi-Channel", variant: "secondary" }}
        >
          <FlowStep
            icon={MessageSquare}
            label="Return requested"
            sublabel="Via GHL conversation, Shopify, or manual entry"
            service={{ name: "GoHighLevel", color: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300" }}
          />
          <FlowStep
            icon={PackageOpen}
            label="Return created in SBR"
            sublabel="Return record with order details, reason, and photos"
            service={{ name: "SBR Inventory", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" }}
          />
          <FlowStep
            icon={Truck}
            label="Return label generated"
            sublabel="Prepaid shipping label sent to customer"
            service={{ name: "Shippo", color: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300" }}
          />
          <FlowStep
            icon={Warehouse}
            label="Product received & inspected"
            sublabel="Item condition assessed, stock adjusted if resellable"
          />
          <FlowStep
            icon={CreditCard}
            label="Refund processed"
            sublabel="Refund issued through original payment method"
            service={{ name: "Shopify", color: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" }}
            isLast
          />
        </FlowCard>

        {/* ─────────── RECONCILIATION FLOW ─────────── */}
        <FlowCard
          title="Shopify Reconciliation"
          description="Scheduled sync to ensure inventory accuracy"
          badge={{ label: "Scheduled", variant: "outline" }}
        >
          <FlowStep
            icon={RefreshCw}
            label="Reconciliation runs"
            sublabel="Tuesdays & Thursdays at 9:00 AM MT (automated)"
          />
          <FlowStep
            icon={BarChart3}
            label="Shopify inventory pulled"
            sublabel="Current stock levels fetched for all active SKUs"
            service={{ name: "Shopify", color: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" }}
          />
          <FlowStep
            icon={Calculator}
            label="Discrepancies detected"
            sublabel="SBR vs Shopify counts compared, mismatches flagged"
          />
          <FlowStep
            icon={CheckCircle2}
            label="Auto-corrected"
            sublabel="Inventory levels synced and adjustment transactions logged"
            isLast
          />
        </FlowCard>

        {/* ─────────── DAILY SALES SYNC ─────────── */}
        <FlowCard
          title="Daily Sales Aggregation"
          description="Nightly sales data processing for analytics"
          badge={{ label: "Scheduled", variant: "outline" }}
        >
          <FlowStep
            icon={RefreshCw}
            label="Daily job runs at 11:59 PM MT"
            sublabel="Collects all sales activity from the past 24 hours"
          />
          <FlowStep
            icon={ShoppingCart}
            label="Shopify orders fetched"
            sublabel="All fulfilled orders pulled with line item details"
            service={{ name: "Shopify", color: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" }}
          />
          <FlowStep
            icon={BarChart3}
            label="Sales history updated"
            sublabel="Per-SKU daily sales aggregated for velocity calculations"
          />
          <FlowStep
            icon={Calculator}
            label="Forecasts recalculated"
            sublabel="AI updates demand projections, reorder points, and safety stock"
            isLast
          />
        </FlowCard>
      </div>
    </div>
  );
}
