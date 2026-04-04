import type { MillFeature, RiskScores, WaterStressData, AqueductLabel } from '../types.ts';

interface MillInfoPanelProps {
  mill:           MillFeature;
  onClose:        () => void;
  activeRadius:   30 | 50 | 100;
  onRadiusSelect: (r: 30 | 50 | 100) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ScoreBar({ label, score }: { label: string; score: 0 | 1 | 2 | 3 | 4 | 5 }) {
  return (
    <div className="score-row">
      <span className="score-label">{label}</span>
      <div className="score-bar-track">
        <div
          className={`score-bar-fill score-fill--${score}`}
          style={{ width: `${(score / 5) * 100}%` }}
        />
      </div>
      <span className={`score-num tier-color--${scoreToTierColor(score)}`}>{score}</span>
    </div>
  );
}

function scoreToTierColor(score: number): string {
  if (score >= 5) return 'CRITICAL';
  if (score >= 4) return 'HIGH';
  if (score >= 3) return 'MEDIUM';
  if (score >= 2) return 'LOW-MEDIUM';
  return 'LOW';
}

/** Dot + label chip for a single Aqueduct indicator. */
function AqIndicator({ name, label }: { name: string; label: AqueductLabel | undefined }) {
  const chipColor: Record<string, string> = {
    'Low':                    '#22c55e',
    'Low-Medium':             '#84cc16',
    'Medium-High':            '#eab308',
    'High':                   '#f97316',
    'Extremely High':         '#ef4444',
    'Arid and Low Water Use': '#94a3b8',
    'No Data':                '#475569',
  };
  const color = chipColor[label ?? 'No Data'] ?? '#475569';
  const display = label ?? '—';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
      <span style={{ fontSize: '10px', color: '#64748b' }}>{name}</span>
      <span style={{ fontSize: '10px', fontWeight: 600, color }}>{display}</span>
    </div>
  );
}

/** Compact water detail block shown beneath the Water Stress score bar. */
function WaterDetail({ d }: { d: WaterStressData }) {
  if (d.bws_label === undefined && d.bwd_label === undefined && d.iav_label === undefined) return null;
  return (
    <div style={{
      margin: '2px 0 6px 0',
      padding: '6px 8px',
      background: 'rgba(255,255,255,0.04)',
      borderRadius: '5px',
      borderLeft: '2px solid rgba(255,255,255,0.10)',
    }}>
      {(d.name_0 || d.name_1) && (
        <div style={{ fontSize: '10px', color: '#475569', marginBottom: '4px', fontStyle: 'italic' }}>
          {[d.name_1, d.name_0].filter(Boolean).join(', ')}
          {d.pfaf_id !== undefined && (
            <span style={{ marginLeft: '6px', color: '#334155' }}>#{d.pfaf_id}</span>
          )}
        </div>
      )}
      <AqIndicator name="Baseline Water Stress"     label={d.bws_label} />
      <AqIndicator name="Baseline Water Depletion"  label={d.bwd_label} />
      <AqIndicator name="Interannual Variability"   label={d.iav_label} />
    </div>
  );
}

const SCORE_ROWS: Array<{ label: string; key: keyof RiskScores }> = [
  { label: 'Tree Cover Loss', key: 'treeCoverLoss' },
  { label: 'Water Stress',    key: 'waterStress'   },
  { label: 'Protected Areas', key: 'protectedArea'  },
  { label: 'Peat Soil',       key: 'peatSoil'       },
  { label: 'Wetland Risk',    key: 'wetlandRisk'    },
];

/** Short factual alert phrases — shown only when condition is true. */
const ALERT_DEFS = [
  { key: 'tclWithin5km'  as const, label: 'Tree cover loss detected within 5 km of the mill' },
  { key: 'tclAllRings'   as const, label: 'Tree cover loss detected across all sourcing rings' },
  { key: 'tclInStrictPA' as const, label: 'Tree cover loss detected within a strictly protected area' },
  { key: 'tclInPeat'     as const, label: 'Tree cover loss detected within peat soil' },
  { key: 'tclInWetland'  as const, label: 'Tree cover loss detected within wetland' },
] as const;

// ── Component ─────────────────────────────────────────────────────────────────

export default function MillInfoPanel({ mill, onClose, activeRadius, onRadiusSelect }: MillInfoPanelProps) {
  const { uml_id, rspo_statu, rspo_certified, waterData, scoresByRadius, alerts, riskTier } =
    mill.properties;

  const radiusKey = `r${activeRadius}` as 'r30' | 'r50' | 'r100';
  const scores = scoresByRadius[radiusKey];

  const tierClass = `risk-tier--${riskTier}` as const;
  const rspoClass = rspo_certified ? 'rspo-pill--certified' : 'rspo-pill--uncertified';
  const rspoLabel = rspo_certified ? '✓ RSPO Certified' : '✕ Not RSPO Certified';

  const activeAlerts = ALERT_DEFS.filter(a => alerts[a.key]);

  const RADII = [30, 50, 100] as const;

  return (
    <div className="glass-panel glass-panel--pad-lg glass-panel--top-right mill-info-panel--dimensions">
      <button className="panel-close-btn" onClick={onClose} aria-label="Close">×</button>

      {/* Header */}
      <div style={{ marginBottom: '12px' }}>
        <span className={`risk-tier-badge ${tierClass}`}>{riskTier}</span>
        <h3 style={{ margin: '8px 0 4px', fontSize: '15px', fontWeight: 700, color: '#f8fafc' }}>
          {uml_id}
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className={`rspo-pill ${rspoClass}`}>{rspoLabel}</span>
          <span style={{ fontSize: '11px', color: '#64748b' }}>{rspo_statu}</span>
        </div>
      </div>

      {/* Scores */}
      <p className="panel-section-title">Environmental Risk Scores</p>
      {SCORE_ROWS.map(({ label, key }) => (
        <div key={key}>
          <ScoreBar label={label} score={scores[key] as 0 | 1 | 2 | 3 | 4 | 5} />
          {key === 'waterStress' && <WaterDetail d={waterData} />}
        </div>
      ))}


      {/* TCL alerts */}
      {activeAlerts.length > 0 && (
        <>
          <p className="panel-section-title">Risk Observations</p>
          <div className="eudr-flag-list">
            {activeAlerts.map(a => (
              <div key={a.key} className="eudr-flag">
                <span className="eudr-flag__icon">⚠</span>
                <span>{a.label}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Radius selector */}
      <div style={{ marginTop: '14px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '12px' }}>
        <p className="panel-section-title" style={{ marginBottom: '8px' }}>Sourcing Radius</p>
        <div className="radius-selector">
          {RADII.map(r => (
            <button
              key={r}
              className={`radius-btn${activeRadius === r ? ' radius-btn--active' : ''}`}
              onClick={() => onRadiusSelect(r)}
            >
              {r} km
            </button>
          ))}
        </div>
        <p style={{ fontSize: '10px', color: '#64748b', marginTop: '6px', fontStyle: 'italic' }}>
          Scores update with radius. Peat and wetland always at 30km.
        </p>
      </div>
    </div>
  );
}
