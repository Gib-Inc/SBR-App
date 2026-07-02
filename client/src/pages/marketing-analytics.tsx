import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { BarChart3, UploadCloud, Activity, Database, Gauge } from 'lucide-react';
import { Link } from 'wouter';
import { KPISummaryBar } from '@/components/marketing-analytics/kpi-summary-bar';
import { CommandCenterView } from '@/components/marketing-analytics/command-center-view';
import { SpendPacingView } from '@/components/marketing-analytics/spend-pacing-view';
import { ChannelMixView } from '@/components/marketing-analytics/channel-mix-view';
import { ProductPerformanceView } from '@/components/marketing-analytics/product-performance-view';
import { CreativeIntelligenceView } from '@/components/marketing-analytics/creative-intelligence-view';
import { SeasonalIntelligenceView } from '@/components/marketing-analytics/seasonal-intelligence-view';
import { BreakevenRoasView } from '@/components/marketing-analytics/breakeven-roas-view';
import { CustomerSplitView } from '@/components/marketing-analytics/customer-split-view';
import { GeographicView } from '@/components/marketing-analytics/geographic-view';
import { CreativeFatigueView } from '@/components/marketing-analytics/creative-fatigue-view';
import { MonthlyPerformanceView } from '@/components/marketing-analytics/monthly-performance-view';
import { TrendView } from '@/components/marketing-analytics/trend-view';
import { SalesVelocityView } from '@/components/marketing-analytics/sales-velocity-view';
import { MultiYearView } from '@/components/marketing-analytics/multi-year-view';
import { CMOHistoryView } from '@/components/marketing-analytics/cmo-history-view';
import { LtvCacView } from '@/components/marketing-analytics/ltv-cac-view';
import { CustomerCohortsView } from '@/components/marketing-analytics/customer-cohorts-view';
import { BomCompletenessView } from '@/components/marketing-analytics/bom-completeness-view';
import { ChannelDeepDiveView } from '@/components/marketing-analytics/channel-deep-dive-view';

export default function MarketingAnalytics() {
  const [days, setDays] = useState(30);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6" />
            Marketing Analytics
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Decision-grade marketing read first. Stale and diagnostic reports are separated from the operating view.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link href="/financial-upload?type=ad_spend" className="inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium hover:bg-muted whitespace-nowrap" data-testid="link-upload-ad">
            <UploadCloud className="h-3.5 w-3.5" /> Upload ad report
          </Link>
          <Select value={String(days)} onValueChange={(v) => setDays(parseInt(v))}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="14">Last 14 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <KPISummaryBar />

      <Tabs defaultValue="decision" className="space-y-4">
        <TabsList className="grid h-auto w-full grid-cols-3 md:w-[560px]">
          <TabsTrigger value="decision" className="gap-1.5"><Gauge className="h-3.5 w-3.5" /> Decision</TabsTrigger>
          <TabsTrigger value="performance" className="gap-1.5"><Activity className="h-3.5 w-3.5" /> Performance</TabsTrigger>
          <TabsTrigger value="diagnostics" className="gap-1.5"><Database className="h-3.5 w-3.5" /> Diagnostics</TabsTrigger>
        </TabsList>
        <TabsContent value="decision">
          <CommandCenterView days={days} />
        </TabsContent>
        <TabsContent value="performance">
          <div className="space-y-4">
            <TrendView />
            <MonthlyPerformanceView />
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <ChannelMixView days={days} />
              <SpendPacingView days={days} />
            </div>
            <ProductPerformanceView days={days} />
          </div>
        </TabsContent>
        <TabsContent value="diagnostics">
          <div className="space-y-4">
            <Alert>
              <Database className="h-4 w-4" />
              <AlertTitle>Diagnostic reports</AlertTitle>
              <AlertDescription>
                These views are useful for investigation, but some rely on older attribution feeds, raw ad rows, or low-confidence shape data. Use the Decision tab for headline spend and ROAS.
              </AlertDescription>
            </Alert>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <ChannelDeepDiveView days={days} />
              <SalesVelocityView days={days} />
              <BreakevenRoasView days={days} />
              <BomCompletenessView days={days} />
              <CustomerSplitView days={days} />
              <GeographicView days={days} />
              <CreativeIntelligenceView days={days} />
              <CreativeFatigueView days={days} />
              <SeasonalIntelligenceView />
              <LtvCacView />
              <CustomerCohortsView />
              <MultiYearView />
              <CMOHistoryView />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
