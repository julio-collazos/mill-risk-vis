#!/usr/bin/env node
/**
 * compute_profiles.cjs
 *
 * Offline build script — pre-computes risk input data for every mill from
 * local PMTiles and the H3 hex index, then writes:
 *   public/data/mill_risk_profiles.json
 *
 * Usage:
 *   node scripts/compute_profiles.cjs
 *
 * Inputs:
 *   public/data/hexagons_index.json    — H3 res-7 forest/peat/wetland ha by year
 *   public/data/pa_aoi.pmtiles         — WDPA protected areas (layer: PA_AOI)
 *   public/data/basins_aoi.pmtiles     — Aqueduct basins (layer: Basins_AOI_Countries)
 *   public/data/mill_location.geojson  — mill points
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const { PMTiles }    = require('../node_modules/pmtiles/dist/cjs/index.cjs');
const { VectorTile } = require('../node_modules/@mapbox/vector-tile/index.js');
const Pbf            = require('../node_modules/pbf/index.js').default;
const h3             = require('../node_modules/h3-js/dist/h3-js.js');

const DATA_DIR = path.join(__dirname, '..', 'public', 'data');

// ─── Node.js PMTiles file source ─────────────────────────────────────────────
class NodeFileSource {
  constructor(fp) { this.fp = fp; this.fd = fs.openSync(fp, 'r'); }
  getKey() { return this.fp; }
  async getBytes(offset, length) {
    const buf = Buffer.allocUnsafe(length);
    fs.readSync(this.fd, buf, 0, length, offset);
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  }
  close() { fs.closeSync(this.fd); }
}

// ─── Tile coordinate helpers ─────────────────────────────────────────────────
function lngLatToTile(lng, lat, z) {
  const n      = Math.pow(2, z);
  const sinLat = Math.sin(lat * Math.PI / 180);
  const x      = Math.floor((lng + 180) / 360 * n);
  const y      = Math.floor((0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * n);
  return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

/** Convert geographic point → tile-space pixel coordinates (extent = 4096) */
function pointToTileCoords(lng, lat, z, tx, ty, extent = 4096) {
  const n      = Math.pow(2, z);
  const mercX  = (lng + 180) / 360;
  const sinLat = Math.sin(lat * Math.PI / 180);
  const mercY  = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
  return {
    px: (mercX * n - tx) * extent,
    py: (mercY * n - ty) * extent,
  };
}

/** Ray-casting point-in-polygon in tile space. rings is Point[][] from loadGeometry(). */
function pointInFeature(px, py, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i].x, yi = ring[i].y;
      const xj = ring[j].x, yj = ring[j].y;
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
  }
  return inside;
}

// ─── PMTiles tile loading with cache ─────────────────────────────────────────
const _tileCache = new Map();

async function loadTile(pmtiles, cachePrefix, z, x, y) {
  const key = `${cachePrefix}|${z}/${x}/${y}`;
  if (_tileCache.has(key)) return _tileCache.get(key);

  const tile = await pmtiles.getZxy(z, x, y);
  if (!tile) { _tileCache.set(key, []); return []; }

  let data = tile.data;
  try { data = zlib.gunzipSync(Buffer.from(data)).buffer; } catch (_) { /* not gzipped */ }

  const vt         = new VectorTile(new Pbf(data));
  const layerNames = Object.keys(vt.layers);
  if (layerNames.length === 0) { _tileCache.set(key, []); return []; }

  const layer    = vt.layers[layerNames[0]];
  const features = [];
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    features.push({ props: f.properties, rings: f.loadGeometry() });
  }
  _tileCache.set(key, features);
  return features;
}

// ─── Per-mill profile computation ────────────────────────────────────────────
const RESTRICTIVE_IUCN = new Set(['Ia', 'Ib', 'II']);
const circleAreaHa = r => Math.PI * r * r * 100; // km → ha

// TCL ring boundaries (km) → H3 k values at res-7 (~2.12 km center-to-center)
const K5  = Math.ceil(5  / 2.12);   // 0–5 km disk
const K10 = Math.ceil(10 / 2.12);   // 0–10 km disk
const K20 = Math.ceil(20 / 2.12);   // 0–20 km disk

// Zoom level for PA and basin tile queries
const Z_PA    = 10;
const Z_BASIN = 6;

async function computeProfile(mill, hexIndex, paPm, basinPm) {
  // mill.geometry may be a MultiPoint or Point
  const coords = mill.geometry.type === 'MultiPoint'
    ? mill.geometry.coordinates[0]
    : mill.geometry.coordinates;
  const [lng, lat] = coords;

  const center = h3.latLngToCell(lat, lng, 7);

  // ── Pre-compute TCL ring membership sets (shared across radius iterations) ─
  const disk5  = new Set(h3.gridDisk(center, K5));
  const disk10 = new Set(h3.gridDisk(center, K10));
  const disk20 = new Set(h3.gridDisk(center, K20));

  // ── Per-radius: TCL + PA + peat + wetland + water ─────────────────────────
  const byRadius = {};

  for (const r of [30, 50, 100]) {
    const k_r      = Math.ceil(r / 2.12);
    const k_half   = Math.ceil((r / 2) / 2.12);
    const cells_r  = h3.gridDisk(center, k_r);
    const innerSet = new Set(h3.gridDisk(center, k_half));
    const areaHa   = circleAreaHa(r);

    // ── TCL — total and per-ring presence ──────────────────────────────────
    let fl21 = 0, fl22 = 0, fl23 = 0, fl24 = 0;
    let ring1 = false, ring2 = false, ring3 = false, ring4 = false;

    // ── Peat & Wetland — outer vs inner ring ───────────────────────────────
    let peat_outer = 0, peat_inner = 0;
    let wetland_outer = 0, wetland_inner = 0;
    let wetland_loss = 0;

    // ── Hex cross flags — TCL co-occurrence with peat/wetland/PA ──────────
    let tclInPeat = false, tclInWetland = false;
    let tclInBothPeatAndWetland = false, tclPeatOrWetlandInPA = false;

    const paTileCache   = new Map();
    const basinTileCache = new Map();

    // ── Water — basin sampling accumulators ────────────────────────────────
    let bws_sum = 0, bwd_sum = 0, iav_sum = 0, basin_count = 0;

    for (const c of cells_r) {
      const rec = hexIndex[c];
      const isInner = innerSet.has(c);

      // ── Peat & Wetland accumulation ──────────────────────────────────────
      const peatHa    = rec?.p ?? 0;
      const wetlandHa = rec?.w ?? 0;
      peat_outer    += peatHa;
      wetland_outer += wetlandHa;
      if (isInner) { peat_inner += peatHa; wetland_inner += wetlandHa; }
      if (rec) wetland_loss += (rec.wl21 ?? 0) + (rec.wl22 ?? 0) + (rec.wl23 ?? 0) + (rec.wl24 ?? 0);

      // ── TCL accumulation ─────────────────────────────────────────────────
      if (rec) {
        const yfl21 = rec.fl21 ?? 0, yfl22 = rec.fl22 ?? 0;
        const yfl23 = rec.fl23 ?? 0, yfl24 = rec.fl24 ?? 0;
        fl21 += yfl21; fl22 += yfl22; fl23 += yfl23; fl24 += yfl24;

        const hasTCL = yfl21 + yfl22 + yfl23 + yfl24 > 0;
        if (hasTCL) {
          if (disk5.has(c))       ring1 = true;
          else if (disk10.has(c)) ring2 = true;
          else if (disk20.has(c)) ring3 = true;
          else                    ring4 = true;

          // Hex cross flags
          const hasPeat    = peatHa > 0;
          const hasWetland = wetlandHa > 0;
          if (hasPeat)               tclInPeat = true;
          if (hasWetland)            tclInWetland = true;
          if (hasPeat && hasWetland) tclInBothPeatAndWetland = true;

          if ((hasPeat || hasWetland) && !tclPeatOrWetlandInPA) {
            const [cLat, cLng] = h3.cellToLatLng(c);
            const { x: tx, y: ty } = lngLatToTile(cLng, cLat, Z_PA);
            const tkey = `${tx}/${ty}`;
            if (!paTileCache.has(tkey)) paTileCache.set(tkey, await loadTile(paPm, 'pa', Z_PA, tx, ty));
            const feats = paTileCache.get(tkey);
            if (feats.length > 0) {
              const { px, py } = pointToTileCoords(cLng, cLat, Z_PA, tx, ty);
              for (const f of feats) {
                if (pointInFeature(px, py, f.rings)) { tclPeatOrWetlandInPA = true; break; }
              }
            }
          }
        }
      }

      // ── Basin lookup for water stress ─────────────────────────────────────
      {
        const [cLat, cLng] = h3.cellToLatLng(c);
        const { x: tx, y: ty } = lngLatToTile(cLng, cLat, Z_BASIN);
        const tkey = `${Z_BASIN}|${tx}/${ty}`;
        if (!basinTileCache.has(tkey)) basinTileCache.set(tkey, await loadTile(basinPm, 'basin', Z_BASIN, tx, ty));
        const feats = basinTileCache.get(tkey);
        if (feats.length > 0) {
          const { px, py } = pointToTileCoords(cLng, cLat, Z_BASIN, tx, ty);
          for (const f of feats) {
            if (pointInFeature(px, py, f.rings)) {
              const bws = f.props.bws_cat ?? -1;
              const bwd = f.props.bwd_cat ?? -1;
              const iav = f.props.iav_cat ?? -1;
              // Only count cells with at least one valid indicator
              if (bws >= 0 || bwd >= 0 || iav >= 0) {
                bws_sum += Math.max(0, bws);
                bwd_sum += Math.max(0, bwd);
                iav_sum += Math.max(0, iav);
                basin_count++;
              }
              break; // a point can be in at most one basin
            }
          }
        }
      }
    }

    // ── Assemble per-radius outputs ────────────────────────────────────────
    const lossHa = fl21 + fl22 + fl23 + fl24;
    const tcl = {
      totalPctArea:  parseFloat((lossHa / areaHa * 100).toFixed(2)),
      hasPostCutoff: lossHa > 0,
      annualPct: [
        parseFloat((fl21 / areaHa * 100).toFixed(2)),
        parseFloat((fl22 / areaHa * 100).toFixed(2)),
        parseFloat((fl23 / areaHa * 100).toFixed(2)),
        parseFloat((fl24 / areaHa * 100).toFixed(2)),
      ],
      rings: { ring1, ring2, ring3, ring4 },
    };

    // PA — sample H3 cell centroids against PA vector tiles
    let totalCells = 0, paCells = 0, restrictiveCells = 0;
    let tclInStrictPA = false;

    for (const c of cells_r) {
      const [cLat, cLng] = h3.cellToLatLng(c);
      const { x: tx, y: ty } = lngLatToTile(cLng, cLat, Z_PA);
      const tkey = `${tx}/${ty}`;
      if (!paTileCache.has(tkey)) paTileCache.set(tkey, await loadTile(paPm, 'pa', Z_PA, tx, ty));
      const feats = paTileCache.get(tkey);
      totalCells++;
      if (feats.length === 0) continue;
      const { px, py } = pointToTileCoords(cLng, cLat, Z_PA, tx, ty);
      let inAny = false, inRestrictive = false;
      for (const f of feats) {
        if (pointInFeature(px, py, f.rings)) {
          inAny = true;
          if (RESTRICTIVE_IUCN.has(f.props.IUCN_CAT)) inRestrictive = true;
        }
      }
      if (inAny)         paCells++;
      if (inRestrictive) restrictiveCells++;

      if (inRestrictive && !tclInStrictPA) {
        const rec = hexIndex[c];
        if (rec) {
          const fl = (rec.fl21 ?? 0) + (rec.fl22 ?? 0) + (rec.fl23 ?? 0) + (rec.fl24 ?? 0);
          if (fl > 0) tclInStrictPA = true;
        }
      }
    }

    const pa = {
      overlapPct:            parseFloat((paCells        / Math.max(totalCells, 1) * 100).toFixed(2)),
      hasRestrictive:        restrictiveCells > 0,
      restrictiveOverlapPct: parseFloat((restrictiveCells / Math.max(totalCells, 1) * 100).toFixed(2)),
      tclInStrictPA,
    };

    const peat = {
      presentWithinRadius:     peat_outer > 0,
      presentWithinHalfRadius: peat_inner > 0,
    };

    const wetland = {
      presentWithinRadius:     wetland_outer > 0,
      presentWithinHalfRadius: wetland_inner > 0,
      hasLoss:                 wetland_loss > 0,
      totalLossHa:             wetland_loss,
    };

    const water = basin_count > 0
      ? {
          bws_cat: Math.round(bws_sum / basin_count),
          bwd_cat: Math.round(bwd_sum / basin_count),
          iav_cat: Math.round(iav_sum / basin_count),
        }
      : { bws_cat: -1, bwd_cat: -1, iav_cat: -1 };

    const hexFlags = { tclInPeat, tclInWetland, tclInBothPeatAndWetland, tclPeatOrWetlandInPA };

    byRadius[`r${r}`] = { tcl, pa, peat, wetland, water, hexFlags };
  }

  return byRadius;
}

// ─── Entry point ─────────────────────────────────────────────────────────────
async function main() {
  console.log('Loading hex index...');
  const hexIndex = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'hexagons_index.json'), 'utf8'));

  console.log('Opening PMTiles...');
  const paPm    = new PMTiles(new NodeFileSource(path.join(DATA_DIR, 'pa_aoi.pmtiles')));
  const basinPm = new PMTiles(new NodeFileSource(path.join(DATA_DIR, 'basins_aoi.pmtiles')));

  const mills = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'mill_location.geojson'), 'utf8'));
  console.log(`Computing profiles for ${mills.features.length} mills...`);

  const profiles = {};
  for (const mill of mills.features) {
    const id = mill.properties.uml_id;
    process.stdout.write(`  ${id} ...`);
    profiles[id] = await computeProfile(mill, hexIndex, paPm, basinPm);
    process.stdout.write(' done\n');
  }

  const outPath = path.join(DATA_DIR, 'mill_risk_profiles.json');
  fs.writeFileSync(outPath, JSON.stringify(profiles));
  console.log(`\nWrote ${mills.features.length} profiles → ${outPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });
