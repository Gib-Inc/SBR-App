import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BarChart3 } from 'lucide-react';
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
            Command center, ad performance, customer intelligence, product ROAS.
          </p>
        </div>
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

      <KPISummaryBar />

      <Tabs defaultValue="command">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="command">Command Center</TabsTrigger>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
          <TabsTrigger value="spend">Spend Pacing</TabsTrigger>
          <TabsTrigger value="channels">Channel Mix</TabsTrigger>
          <TabsTrigger value="breakeven">Break-even</TabsTrigger>
          <TabsTrigger value="customers">Customers</TabsTrigger>
          <TabsTrigger value="geography">Geography</TabsTrigger>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="creative">Creative Intel</TabsTrigger>
          <TabsTrigger value="fatigue">Fatigue</TabsTrigger>
          <TabsTrigger value="seasonal">Seasonal</TabsTrigger>
        </TabsList>
        <TabsContent value="command"><CommandCenterView days={days} /></TabsContent>
        <TabsContent value="monthly"><MonthlyPerformanceView /></TabsContent>
        <TabsContent value="spend"><SpendPacingView days={days} /></TabsContent>
        <TabsContent value="channels"><ChannelMixView days={days} /></TabsContent>
        <TabsContent value="breakeven"><BreakevenRoasView days={days} /></TabsContent>
        <TabsContent value="customers"><CustomerSplitView days={days} /></TabsContent>
        <TabsContent value="geography"><GeographicView days={days} /></TabsContent>
        <TabsContent value="products"><ProductPerformanceView days={days} /></TabsContent>
        <TabsContent value="creative"><CreativeIntelligenceView days={days} /></TabsContent>
        <TabsContent value="fatigue"><CreativeFatigueView days={days} /></TabsContent>
        <TabsContent value="seasonal"><SeasonalIntelligenceView /></TabsContent>
      </Tabs>
    </div>
  );
}
