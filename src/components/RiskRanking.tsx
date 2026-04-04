import { useState, useMemo } from 'react';
import type { MillFeature, RiskTier, RadiusKey } from '../types.ts';
import { FINAL_SCORE_CEILING } from '../risk-data.ts';

interface RiskRankingProps {
  mills: MillFeature[];
  hoveredMillId: string | null;
  onMillClick: (mill: MillFeature) => void;
  onMillHover: (id: string | null) => void;
}

const RADII = [30, 50, 100] as const;
type RankingRadius = 30 | 50 | 100;

// Grid layout: rank | mill id + rspo | tier | TCL | WAT | PA | PEAT | WET | Total
const GRID = '20px 1fr 90px 26px 26px 26px 26px 26px 36px';

function ScoreCell({ score }: { score: number }) {
  const color =
    score >= 5 ? '#ef4444' :
    score >= 4 ? '#f97316' :
    score >= 3 ? '#eab308' :
    score >= 2 ? '#84cc16' :
    score >= 1 ? '#22c55e' : '#475569';
  return (
    <div style={{ textAlign: 'center', fontSize: '11px', fontWeight: 700, color }}>{score}</div>
  );
}

function TierBadge({ tier }: { tier: RiskTier }) {
  return (
    <span
      className={`risk-tier-badge risk-tier--${tier}`}
      style={{ fontSize: '9px', padding: '2px 6px', letterSpacing: '0.05em' }}
    >
      {tier}
    </span>
  );
}

export default function RiskRanking({
  mills,
  hoveredMillId,
  onMillClick,
  onMillHover,
}: RiskRankingProps) {
  const [rankingRadius, setRankingRadius] = useState<RankingRadius>(50);
  const [tooltipMillId, setTooltipMillId] = useState<string | null>(null);
  const radiusKey = `r${rankingRadius}` as RadiusKey;

  const sortedMills = useMemo(() =>
    [...mills].sort((a, b) =>
      b.properties.finalScoreByRadius[radiusKey] -
      a.properties.finalScoreByRadius[radiusKey]
    ),
    [mills, radiusKey],
  );

  return (
    <div className="glass-panel glass-panel--pad-lg glass-panel--bottom-right ranking-panel">

      {/* Header */}
      <div className="panel-divider ranking-header">
        <h3 className="panel-title" style={{ margin: 0 }}>Regional Mill Risk Matrix</h3>
        <div style={{ display: 'flex', gap: '4px' }}>
          {RADII.map(r => (
            <button
              key={r}
              className={`radius-btn${rankingRadius === r ? ' radius-btn--active' : ''}`}
              style={{ flex: 'unset', padding: '3px 8px', fontSize: '10px' }}
              onClick={() => setRankingRadius(r)}
            >
              {r} km
            </button>
          ))}
        </div>
      </div>

      {/* Column labels */}
      <div style={{
        display: 'grid', gridTemplateColumns: GRID,
        gap: '6px', padding: '0 8px 8px',
        fontSize: '9px', fontWeight: 700, color: '#475569',
        textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0,
      }}>
        <div>#</div>
        <div>Mill</div>
        <div>Tier</div>
        <div style={{ textAlign: 'center' }}>TCL</div>
        <div style={{ textAlign: 'center' }}>WAT</div>
        <div style={{ textAlign: 'center' }}>PA</div>
        <div style={{ textAlign: 'center' }}>PEAT</div>
        <div style={{ textAlign: 'center' }}>WET</div>
        <div style={{ textAlign: 'center' }}>Score</div>
      </div>

      {/* Rows */}
      <div className="ranking-list">
        {sortedMills.map((feature, idx) => {
          const p        = feature.properties;
          const scores   = p.scoresByRadius[radiusKey];
          const riskTier = p.riskTierByRadius[radiusKey];
          const total    = p.finalScoreByRadius[radiusKey];
          const isActive = hoveredMillId === p.uml_id;
          return (
            <div
              key={p.uml_id || idx}
              className={`ranking-row${isActive ? ' ranking-row--active' : ''}`}
              style={{ display: 'grid', gridTemplateColumns: GRID, gap: '6px', padding: '7px 8px' }}
              onClick={() => onMillClick(feature)}
              onMouseEnter={() => onMillHover(p.uml_id)}
              onMouseLeave={() => onMillHover(null)}
            >
              <div className="rank-badge">{idx + 1}</div>

              {/* Mill ID + RSPO dot */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
                <span
                  title={p.rspo_certified ? 'RSPO Certified' : 'Not RSPO Certified'}
                  style={{
                    width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0,
                    backgroundColor: p.rspo_certified ? '#22c55e' : '#475569',
                  }}
                />
                <span
                  className="mill-name"
                  style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', position: 'relative', cursor: 'default' }}
                  onMouseEnter={() => setTooltipMillId(p.uml_id)}
                  onMouseLeave={() => setTooltipMillId(null)}
                >
                  {p.uml_id}
                  {tooltipMillId === p.uml_id && (
                    <span style={{
                      position: 'absolute', bottom: '100%', left: 0, marginBottom: '4px',
                      background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '4px', padding: '4px 8px',
                      fontSize: '10px', fontWeight: 700, color: '#f8fafc',
                      letterSpacing: '0.08em', whiteSpace: 'nowrap', zIndex: 100,
                    }}>
                      COMPOSITE SCORE {p.finalScore}
                    </span>
                  )}
                </span>
              </div>

              <TierBadge tier={riskTier} />
              <ScoreCell score={scores.treeCoverLoss} />
              <ScoreCell score={scores.waterStress} />
              <ScoreCell score={scores.protectedArea} />
              <ScoreCell score={scores.peatSoil} />
              <ScoreCell score={scores.wetlandRisk} />
              <div style={{ textAlign: 'center', fontSize: '11px', fontWeight: 800, color: '#f8fafc' }}>
                {total}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer legend */}
      <div style={{
        marginTop: '8px', paddingTop: '8px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', gap: '12px', flexShrink: 0,
        fontSize: '10px', color: '#475569',
      }}>
        <span><span style={{ color: '#22c55e' }}>●</span> RSPO certified</span>
        <span><span style={{ color: '#475569' }}>●</span> Not certified</span>
        <span style={{ marginLeft: 'auto' }}>each column 0–5 · total 1–{FINAL_SCORE_CEILING}</span>
      </div>
    </div>
  );
}
