// ─────────────────────────────────────────────────────────────────────────────
// Spatial input data
// These are the pre-computed values derived from GFW / Aqueduct / WDPA / CIFOR.
// In production these are computed offline and baked into the GeoJSON.
// ─────────────────────────────────────────────────────────────────────────────

export interface TCLData {
  /** % of sourcing radius covered by ANY GFW tree cover loss pixel (all years combined) */
  totalPctArea: number;
  /** True if any pixel has loss year ≥ 2021 (kept for data compatibility) */
  hasPostCutoff: boolean;
  /** Annual deforestation rate within radius — new area lost each year [2020, 2021, 2022, 2023] */
  annualPct: [number, number, number, number];
}

export type AqueductLabel =
  | 'Low' | 'Low-Medium' | 'Medium-High' | 'High' | 'Extremely High'
  | 'No Data' | 'Arid and Low Water Use';

/**
 * WRI Aqueduct water risk fields saved per mill.
 * Cat values: 0=Low … 4=Extremely High, -1=No Data.
 *
 * Legacy note: profiles computed before this schema update only carry `aqueductClass`
 * (= bws_label). New-format scoring uses max(bws_cat, bwd_cat, iav_cat).
 */
export interface WaterStressData {
  // ── Location / basin identifiers ──────────────────────────────────────────
  /** Pfafstetter 6-digit hydrological basin code */
  pfaf_id?: number;
  /** Country name (GADM name_0) */
  name_0?: string;
  /** Sub-national region name (GADM name_1) */
  name_1?: string;

  // ── Baseline Water Stress (bws) ───────────────────────────────────────────
  bws_cat?:   number;
  bws_label?: AqueductLabel;

  // ── Baseline Water Depletion (bwd) ────────────────────────────────────────
  bwd_cat?:   number;
  bwd_label?: AqueductLabel;

  // ── Interannual Variability (iav) ─────────────────────────────────────────
  iav_cat?:   number;
  iav_label?: AqueductLabel;

  // ── Legacy (single-indicator profiles generated before this schema) ───────
  /** @deprecated Use bws_label. Kept for backward compat with old profiles.json. */
  aqueductClass?: 'Low' | 'Low-Medium' | 'Medium-High' | 'High' | 'Extremely High' | 'No Data';
}

export interface ProtectedAreaData {
  /** Total % of sourcing radius overlapping any WDPA feature */
  overlapPct: number;
  /** True if any overlap includes IUCN category Ia/Ib/II */
  hasRestrictive: boolean;
  /** % of sourcing radius inside restrictive categories only */
  restrictiveOverlapPct: number;
  /** True if any hex in the radius has both TCL and a strict IUCN PA */
  tclInStrictPA: boolean;
}

export interface PeatData {
  /** Peat present anywhere within the analysis radius */
  presentWithinRadius: boolean;
  /** Peat present within half the analysis radius (proximity sentinel — inner ring) */
  presentWithinHalfRadius: boolean;
}

export interface WetlandData {
  /** Wetland present anywhere within the analysis radius */
  presentWithinRadius: boolean;
  /** Wetland present within half the analysis radius (inner ring) */
  presentWithinHalfRadius: boolean;
  /** True if any wetland loss detected within the radius (wl21–wl24 > 0) */
  hasLoss: boolean;
  /** Total wetland loss in hectares within the radius (wl21+wl22+wl23+wl24) */
  totalLossHa: number;
}

/** TCL presence flags per distance ring (independent donut buffers). */
export interface TCLRings {
  ring1: boolean;  // 0–5 km
  ring2: boolean;  // 5–10 km donut
  ring3: boolean;  // 10–20 km donut
  ring4: boolean;  // 20–outer km donut (outer varies by active radius: 30/50/100)
}

/**
 * Cross-variable hex flags — computed at the analysis radius for any hex where
 * TCL co-occurs with peat, wetland, or protected area. Enables compound risk conditions.
 */
export interface HexCrossFlags {
  /** Any hex within the radius has both TCL and peat soil */
  tclInPeat: boolean;
  /** Any hex within the radius has both TCL and wetland */
  tclInWetland: boolean;
  /** Any hex within the radius has TCL, peat, AND wetland simultaneously */
  tclInBothPeatAndWetland: boolean;
  /** Any hex within the radius has TCL (with peat or wetland) AND falls in a PA */
  tclPeatOrWetlandInPA: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk scores  (binary condition accumulation — 0–5 per variable)
// Each score = count of true binary conditions (see risk-data.ts for logic).
// Water stress is the exception: scored 1–5 directly from Aqueduct categories.
// ─────────────────────────────────────────────────────────────────────────────

export interface RiskScores {
  treeCoverLoss: 0 | 1 | 2 | 3 | 4 | 5;
  waterStress:   1 | 2 | 3 | 4 | 5;
  protectedArea: 0 | 1 | 2 | 3 | 4 | 5;
  peatSoil:      0 | 1 | 2 | 3 | 4 | 5;
  wetlandRisk:   0 | 1 | 2 | 3 | 4 | 5;
}

// ─────────────────────────────────────────────────────────────────────────────
// Overall risk tier
// Derived from finalScore (1–25 sum of all variable scores).
// ─────────────────────────────────────────────────────────────────────────────

export type RiskTier =
  | 'LOW'
  | 'LOW-MEDIUM'
  | 'MEDIUM'
  | 'MEDIUM-HIGH'
  | 'HIGH'
  | 'CRITICAL';

// ─────────────────────────────────────────────────────────────────────────────
// Mill alerts  (factual short phrases shown in the info panel)
// Only true conditions are surfaced — no regulatory citations.
// ─────────────────────────────────────────────────────────────────────────────

export interface MillAlerts {
  /** TCL condition 1 — deforestation within 5 km of the mill */
  tclWithin5km: boolean;
  /** TCL condition 5 — loss detected across all sourcing rings (pervasive) */
  tclAllRings: boolean;
  /** PA condition 3 — tree cover loss detected within a strictly protected area */
  tclInStrictPA: boolean;
  /** Peat condition 3 — tree cover loss intersects peat soil */
  tclInPeat: boolean;
  /** Wetland condition 3 — tree cover loss intersects wetland */
  tclInWetland: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mill feature
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Multi-radius scores  (Analysis mode — 30 km / 50 km / 100 km)
// ─────────────────────────────────────────────────────────────────────────────

export type RadiusKey = 'r30' | 'r50' | 'r100';

export interface ScoresByRadius {
  r30:  RiskScores;
  r50:  RiskScores;
  r100: RiskScores;
}

export interface FinalScoreByRadius {
  r30:  number;
  r50:  number;
  r100: number;
}

export interface RiskTierByRadius {
  r30:  RiskTier;
  r50:  RiskTier;
  r100: RiskTier;
}

export interface MillProperties {
  OBJECTID?: number;
  uml_id: string;
  /** Raw RSPO status string from source data */
  rspo_statu: string;
  /** Parsed from rspo_statu */
  rspo_certified: boolean;

  // Spatial input data
  tclData:     TCLData;
  waterData:   WaterStressData;
  paData:      ProtectedAreaData;
  peatData:    PeatData;
  wetlandData: WetlandData;
  hexFlags:    HexCrossFlags;

  // Computed scores & tier (weighted convergence across all three radii)
  scores:      RiskScores;
  finalScore:  number;      // convergence-weighted score (1–25), r30×0.5 + r50×0.3 + r100×0.2 ± proximity bonus
  riskTier:    RiskTier;
  alerts:      MillAlerts;
  /** True when risk is predominantly landscape-driven (r100 score exceeds r30 score by ≥6 pts) */
  riskDiluted: boolean;

  // Multi-radius scores for Analysis mode
  scoresByRadius:     ScoresByRadius;
  finalScoreByRadius: FinalScoreByRadius;
  riskTierByRadius:   RiskTierByRadius;
}

export interface MillFeature {
  type: 'Feature';
  geometry: {
    type: string;
    coordinates: number[] | number[][];
  };
  properties: MillProperties;
}

export interface MillsGeoJSON {
  type: 'FeatureCollection';
  features: MillFeature[];
}

// ─────────────────────────────────────────────────────────────────────────────
// UI helpers
// ─────────────────────────────────────────────────────────────────────────────

export interface HoverInfo {
  x: number;
  y: number;
  feature: MillFeature;
}

export interface ActiveLayers {
  esa: boolean;
  treeLoss: boolean;
  buffer: boolean;
  hexLoss: boolean;
  paLocal: boolean;
  basinsLocal: boolean;
}

export interface LensLocation {
  lat: number;
  lng: number;
}
