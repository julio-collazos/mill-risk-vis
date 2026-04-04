import type { HoverInfo } from '../types.ts';
import { FINAL_SCORE_CEILING } from '../risk-data.ts';

interface MapTooltipProps {
  hoverInfo: HoverInfo;
}

export default function MapTooltip({ hoverInfo }: MapTooltipProps) {
  const { uml_id, riskTier, finalScore } = hoverInfo.feature.properties;
  return (
    <div
      className="map-tooltip"
      style={{ left: hoverInfo.x, top: hoverInfo.y - 15 }}
    >
      <div className="tooltip-mill-name">{uml_id}</div>
      <div className={`tooltip-rank tier-color--${riskTier}`}>{riskTier}</div>
      <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>
        Score: {typeof finalScore === 'number' ? finalScore : '—'} / {FINAL_SCORE_CEILING}
      </div>
    </div>
  );
}
