import type { ActiveLayers } from '../types.ts';

const LAYER_LABELS: Record<keyof ActiveLayers, string> = {
  esa:         'ESA Land Cover',
  treeLoss:    'GFW Tree Loss',
  buffer:      'Buffer Rings',
  hexLoss:     'Ecosystem Index',
  paLocal:     'Protected Areas',
  basinsLocal: 'Aqueduct Basins',
};

const HIDDEN_LAYERS: (keyof ActiveLayers)[] = ['buffer'];

interface LayerToggleProps {
  activeLayers: ActiveLayers;
  onToggle: (key: keyof ActiveLayers) => void;
}

export default function LayerToggle({ activeLayers, onToggle }: LayerToggleProps) {
  return (
    <div className="glass-panel glass-panel--pad-md glass-panel--top-left-70">
      <h3 className="panel-title">Map Layers</h3>
      {(Object.keys(activeLayers) as (keyof ActiveLayers)[]).filter(key => !HIDDEN_LAYERS.includes(key)).map((key) => (
        <div key={key} className="layer-item">
          <label className="layer-label">
            <input
              type="checkbox"
              className="layer-checkbox"
              checked={activeLayers[key]}
              onChange={() => onToggle(key)}
            />
            {LAYER_LABELS[key]}
          </label>
        </div>
      ))}
    </div>
  );
}
