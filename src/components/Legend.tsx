import { useState, useEffect } from 'react';
import type { ActiveLayers } from '../types.ts';

const ESA_ENTRIES = [
  { color: '#006400', label: 'Tree cover' },
  { color: '#ffbb22', label: 'Shrubland' },
  { color: '#ffff4c', label: 'Grassland' },
  { color: '#f096ff', label: 'Cropland' },
  { color: '#fa0000', label: 'Built-up' },
  { color: '#b4b4b4', label: 'Bare/sparse' },
  { color: '#0064c8', label: 'Water bodies' },
  { color: '#0096a0', label: 'Wetlands' },
];

// Ecosystem type (color) + loss intensity (opacity)
const HEX_LOSS_ENTRIES = [
  { color: '#166534', label: 'Forest'   },
  { color: '#0c4a6e', label: 'Wetland'  },
  { color: '#78350f', label: 'Peatland' },
];

const PA_ENTRIES = [
  { color: 'rgba(34,197,94,0.65)',  label: 'Strictly protected (Ia/Ib/II)' },
  { color: 'rgba(34,197,94,0.30)',  label: 'Other protected area' },
];

const BASIN_ENTRIES = [
  { color: '#4575b4', label: 'Low' },
  { color: '#91bfdb', label: 'Low – Medium' },
  { color: '#fee090', label: 'Medium – High' },
  { color: '#fc8d59', label: 'High' },
  { color: '#d73027', label: 'Extremely High' },
];

interface LegendProps {
  activeLayers: ActiveLayers;
}

interface Section {
  key: string;
  title: string;
  entries: { color: string; label: string }[];
  swatch?: 'square' | 'line';
}

interface SectionProps {
  title: string;
  entries: { color: string; label: string }[];
  swatch?: 'square' | 'line';
}

function LegendSection({ title, entries, swatch = 'square' }: SectionProps) {
  return (
    <div className="legend-section">
      <div className="legend-section-title">{title}</div>
      <div className="legend-grid">
        {entries.map(({ color, label }) => (
          <div key={label} className="legend-item">
            {swatch === 'line' ? (
              <span className="legend-swatch-line" style={{ backgroundColor: color }} />
            ) : (
              <span className="legend-swatch" style={{ backgroundColor: color }} />
            )}
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Legend({ activeLayers }: LegendProps) {
  const [currentIdx, setCurrentIdx] = useState(0);

  const sections: Section[] = [];
  if (activeLayers.esa)          sections.push({ key: 'esa',    title: 'ESA Land Cover',   entries: ESA_ENTRIES });
  if (activeLayers.hexLoss)      sections.push({ key: 'hex',    title: 'Ecosystem Index',  entries: HEX_LOSS_ENTRIES });
  if (activeLayers.paLocal)      sections.push({ key: 'pa',     title: 'Protected Areas',  entries: PA_ENTRIES });
  if (activeLayers.basinsLocal)  sections.push({ key: 'basins', title: 'Aqueduct Basins',  entries: BASIN_ENTRIES });

  // Clamp index when layers toggle off
  useEffect(() => {
    if (sections.length > 0 && currentIdx >= sections.length) {
      setCurrentIdx(sections.length - 1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLayers]);

  if (sections.length === 0) return null;

  const safeIdx = Math.min(currentIdx, sections.length - 1);
  const active  = sections[safeIdx];

  return (
    <div className="glass-panel glass-panel--pad-sm glass-panel--radius-sm glass-panel--bottom-left">
      <LegendSection title={active.title} entries={active.entries} swatch={active.swatch} />

      {sections.length > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginTop: '8px' }}>
          {sections.map((s, i) => (
            <button
              key={s.key}
              onClick={() => setCurrentIdx(i)}
              title={s.title}
              style={{
                width:        '8px',
                height:       '8px',
                borderRadius: '50%',
                background:   i === safeIdx ? '#4ade9e' : 'rgba(255,255,255,0.25)',
                border:       'none',
                padding:      0,
                cursor:       'pointer',
                transition:   'background 0.2s',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
