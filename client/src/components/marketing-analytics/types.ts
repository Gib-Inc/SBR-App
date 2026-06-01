export interface DailySpend {
  date: string;
  spend: number;
  revenue: number;
  impressions: number;
  clicks: number;
  conversions: number;
}

export interface SpendPacingData {
  daily: DailySpend[];
  mtdSpend: number;
  mtdRevenue: number;
  projectedMonthEnd: number;
  spendRevenueRatio: number | null;
  daysInPeriod: number;
}

export interface ChannelData {
  platform: string;
  spend: number;
  revenue: number;
  conversions: number;
  clicks: number;
  impressions: number;
  cpa: number | null;
  roas: number | null;
}

export interface ChannelMixData {
  channels: ChannelData[];
  blendedRoas: number | null;
  tacos: number | null;
  totalSpend: number;
  totalRevenue: number;
}

export interface ProductData {
  sku: string;
  name: string | null;
  available_qty: number | null;
  hildale_qty: number | null;
  spend: number;
  revenue: number;
  conversions: number;
  roas: number | null;
  days_of_stock: number | null;
  conflict: 'LOW_STOCK_HIGH_SPEND' | 'HIGH_STOCK_NO_ADS' | null;
}

export interface KPIData {
  mtd_spend: number;
  mtd_revenue: number;
  blended_roas: number | null;
  total_conversions: number;
  avg_cpa: number | null;
}

export interface YoYWeek {
  week_num: number;
  current_revenue: number;
  prior_revenue: number;
  current_orders: number;
  prior_orders: number;
}

export interface ConversionTrend {
  week_num: number;
  conv_rate: number | null;
  ctr: number | null;
  spend: number;
}
