import { RevenueTargetGauge } from './revenue-target-gauge';
import { NextBestActionView } from './next-best-action-view';
import { WastedSpendView } from './wasted-spend-view';
import { ChannelOpportunityMatrix } from './channel-opportunity-matrix';

export function CommandCenterView({ days }: { days: number }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RevenueTargetGauge />
        <WastedSpendView days={days} compact />
      </div>
      <NextBestActionView />
      <ChannelOpportunityMatrix days={days} />
    </div>
  );
}
