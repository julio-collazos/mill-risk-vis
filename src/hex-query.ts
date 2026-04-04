/**
 * hex-query.ts
 *
 * Loads hexagons_index.json once and provides circle-query aggregation.
 *
 * Index schema per cell (compact keys):
 *   f  = forest_ha    w  = wetland_ha   p  = peatland_ha
 *   fl21–fl24 = forest loss ha by year  (2021–2024)
 *   wl21–wl24 = wetland loss ha by year
 *   pl21–pl24 = peatland loss ha by year
 */

import * as h3 from 'h3-js';

type HexRecord = {
  f?: number; w?: number; p?: number;
  fl21?: number; fl22?: number; fl23?: number; fl24?: number;
  wl21?: number; wl22?: number; wl23?: number; wl24?: number;
  pl21?: number; pl22?: number; pl23?: number; pl24?: number;
};

type HexIndex = Record<string, HexRecord>;

let _index: HexIndex | null = null;
let _loading: Promise<HexIndex> | null = null;

async function getIndex(): Promise<HexIndex> {
  if (_index) return _index;
  if (_loading) return _loading;
  _loading = fetch('/data/hexagons_index.json')
    .then(r => r.json() as Promise<HexIndex>)
    .then(data => { _index = data; _loading = null; return data; });
  return _loading;
}

export interface AggResult {
  forest_ha: number; wetland_ha: number; peat_ha: number;
  fl21: number; fl22: number; fl23: number; fl24: number;
  wl21: number; wl22: number; wl23: number; wl24: number;
  pl21: number; pl22: number; pl23: number; pl24: number;
  cellCount: number;
}

function emptyAgg(): AggResult {
  return {
    forest_ha: 0, wetland_ha: 0, peat_ha: 0,
    fl21: 0, fl22: 0, fl23: 0, fl24: 0,
    wl21: 0, wl22: 0, wl23: 0, wl24: 0,
    pl21: 0, pl22: 0, pl23: 0, pl24: 0,
    cellCount: 0,
  };
}

/**
 * Query H3 resolution-7 hexagons within a circle and aggregate ha values.
 *
 * Uses gridDisk with k = ceil(radiusKm / 2.12) rings.
 * H3 res-7 mean hex center-to-center distance ≈ 2.12 km.
 */
export async function queryCircle(
  lat: number,
  lng: number,
  radiusKm: number,
): Promise<AggResult> {
  const index = await getIndex();
  const center = h3.latLngToCell(lat, lng, 7);
  const k = Math.ceil(radiusKm / 2.12);
  const cells = h3.gridDisk(center, k);

  const acc = emptyAgg();
  for (const cell of cells) {
    const r = index[cell];
    if (!r) continue;
    acc.forest_ha  += r.f   ?? 0;
    acc.wetland_ha += r.w   ?? 0;
    acc.peat_ha    += r.p   ?? 0;
    acc.fl21 += r.fl21 ?? 0;
    acc.fl22 += r.fl22 ?? 0;
    acc.fl23 += r.fl23 ?? 0;
    acc.fl24 += r.fl24 ?? 0;
    acc.wl21 += r.wl21 ?? 0;
    acc.wl22 += r.wl22 ?? 0;
    acc.wl23 += r.wl23 ?? 0;
    acc.wl24 += r.wl24 ?? 0;
    acc.pl21 += r.pl21 ?? 0;
    acc.pl22 += r.pl22 ?? 0;
    acc.pl23 += r.pl23 ?? 0;
    acc.pl24 += r.pl24 ?? 0;
    acc.cellCount++;
  }
  return acc;
}

// ─── GeoJSON builder ──────────────────────────────────────────────────────────

export interface HexProperties {
  hex_id:     string;
  /** Dominant ecosystem: 'f' = forest, 'w' = wetland, 'p' = peatland */
  dominant:   'f' | 'w' | 'p';
  /** Total ecosystem loss = forest loss + wetland loss (fl21–fl24 + wl21–wl24) */
  total_ecosystem_loss: number;
  f: number; w: number; p: number;
  fl21: number; fl22: number; fl23: number; fl24: number;
  wl21: number; wl22: number; wl23: number; wl24: number;
  pl21: number; pl22: number; pl23: number; pl24: number;
}

export interface HexFeatureCollection {
  type: 'FeatureCollection';
  features: Array<{
    type:       'Feature';
    geometry:   { type: 'Polygon'; coordinates: [number, number][][] };
    properties: HexProperties;
  }>;
}

function buildHexFeature(
  cell: string,
  r: HexRecord,
): HexFeatureCollection['features'][number] | null {
  const f = r.f ?? 0, w = r.w ?? 0, p = r.p ?? 0;
  if (f + w + p === 0) return null;

  // cellToBoundary → [[lat,lng],...]; GeoJSON needs [[lng,lat],...]
  const ring: [number, number][] = h3.cellToBoundary(cell).map(([la, lo]) => [lo, la]);
  ring.push(ring[0]); // close the ring

  const dominant: 'f' | 'w' | 'p' =
    p > 0 ? 'p' : w > 0 ? 'w' : 'f';

  const total_ecosystem_loss =
    (r.fl21 ?? 0) + (r.fl22 ?? 0) + (r.fl23 ?? 0) + (r.fl24 ?? 0) +
    (r.wl21 ?? 0) + (r.wl22 ?? 0) + (r.wl23 ?? 0) + (r.wl24 ?? 0);

  return {
    type:     'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: {
      hex_id: cell, dominant, total_ecosystem_loss, f, w, p,
      fl21: r.fl21 ?? 0, fl22: r.fl22 ?? 0,
      fl23: r.fl23 ?? 0, fl24: r.fl24 ?? 0,
      wl21: r.wl21 ?? 0, wl22: r.wl22 ?? 0,
      wl23: r.wl23 ?? 0, wl24: r.wl24 ?? 0,
      pl21: r.pl21 ?? 0, pl22: r.pl22 ?? 0,
      pl23: r.pl23 ?? 0, pl24: r.pl24 ?? 0,
    },
  };
}

/**
 * Build a GeoJSON FeatureCollection of ALL hexagons in the index.
 * Used for the global always-on hex layer.
 */
export async function getAllHexagonsAsGeoJSON(): Promise<HexFeatureCollection> {
  const index = await getIndex();
  const features: HexFeatureCollection['features'] = [];

  for (const [cell, r] of Object.entries(index)) {
    const feat = buildHexFeature(cell, r);
    if (feat) features.push(feat);
  }

  return { type: 'FeatureCollection', features };
}
