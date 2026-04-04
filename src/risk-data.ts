import rawMillsDataStr from './data/mill_location.geojson?raw';
import profilesJson    from './data/mill_risk_profiles.json';
import type {
  TCLData,
  WaterStressData,
  ProtectedAreaData,
  PeatData,
  WetlandData,
  HexCrossFlags,
  TCLRings,
  RiskScores,
  RiskTier,
  MillAlerts,
  MillProperties,
  MillsGeoJSON,
  MillFeature,
  ScoresByRadius,
  FinalScoreByRadius,
  RiskTierByRadius,
} from './types.ts';

export const ANALYSIS_CEILING = 5;
export const FINAL_SCORE_CEILING = 25;

// ─── Water scoring (unchanged — direct Aqueduct category mapping) ─────────────

/** Convert an Aqueduct category integer (0–4, -1=No Data) to a 1–5 risk score. */
function catToScore(cat: number): 1 | 2 | 3 | 4 | 5 {
  if (cat < 0) return 3; // No Data / Arid → medium default
  return Math.min(5, cat + 1) as 1 | 2 | 3 | 4 | 5;
}

function scoreWater(d: WaterStressData): 1 | 2 | 3 | 4 | 5 {
  if (d.bws_cat !== undefined && d.bwd_cat !== undefined && d.iav_cat !== undefined) {
    return Math.max(
      catToScore(d.bws_cat),
      catToScore(d.bwd_cat),
      catToScore(d.iav_cat),
    ) as 1 | 2 | 3 | 4 | 5;
  }
  // Legacy single-indicator fallback (old profiles.json format)
  const legacyMap: Record<string, 1 | 2 | 3 | 4 | 5> = {
    'Low': 1, 'Low-Medium': 2, 'Medium-High': 3, 'High': 4, 'Extremely High': 5, 'No Data': 3,
  };
  return legacyMap[d.aqueductClass ?? 'No Data'] ?? 3;
}

// ─── Binary condition scoring ─────────────────────────────────────────────────
//
// Each variable scores 0–5 by summing 5 binary (0/1) conditions.
// The final score is the raw sum across all 5 variables (range 1–25).
//
// TCL — ring-based proximity (independent donut buffers)
//   c1: TCL present in 0–5 km ring
//   c2: TCL present in 5–10 km donut
//   c3: TCL present in 10–20 km donut
//   c4: TCL present in 20–outer km donut
//   c5: all four rings true (pervasive landscape-level loss)
//
// PA — compound governance + spatial conditions
//   c1: any PA present in buffer
//   c2: strict IUCN categories (Ia/Ib/II) present
//   c3: TCL detected within a strict PA
//   c4: mill is NOT RSPO certified
//   c5: all four above true
//
// Peat — presence + compound ecosystem risk (per-radius; inner ring = r/2)
//   c1: peat present within half the analysis radius (proximity gate)
//   c2: peat present within full radius AND water score ≥ 4
//   c3: TCL intersects peat hexagons
//   c4: TCL hexagons contain BOTH peat and wetland
//   c5: TCL + peat/wetland hexagons also in a PA
//
// Wetland — same framework as peat (both are high-carbon ecosystems)
//   c1: wetland present within half the analysis radius (proximity gate)
//   c2: wetland present within full radius AND water score ≥ 4
//   c3: TCL intersects wetland hexagons
//   c4: TCL hexagons contain BOTH peat and wetland
//   c5: TCL + peat/wetland hexagons also in a PA

function countTrue(...flags: boolean[]): 0 | 1 | 2 | 3 | 4 | 5 {
  return flags.filter(Boolean).length as 0 | 1 | 2 | 3 | 4 | 5;
}

function scoreTCL(rings: TCLRings): 0 | 1 | 2 | 3 | 4 | 5 {
  const { ring1, ring2, ring3, ring4 } = rings;
  const allRings = ring1 && ring2 && ring3 && ring4;
  return countTrue(ring1, ring2, ring3, ring4, allRings);
}

function scorePA(
  pa: ProtectedAreaData,
  rspoCertified: boolean,
): 0 | 1 | 2 | 3 | 4 | 5 {
  const c1 = pa.overlapPct > 0;
  const c2 = pa.hasRestrictive;
  const c3 = pa.tclInStrictPA;
  const c4 = !rspoCertified;
  const c5 = c1 && c2 && c3 && c4;
  return countTrue(c1, c2, c3, c4, c5);
}

function scorePeat(
  peat: PeatData,
  waterScore: 1 | 2 | 3 | 4 | 5,
  hexFlags: HexCrossFlags,
): 0 | 1 | 2 | 3 | 4 | 5 {
  const c1 = peat.presentWithinHalfRadius;                   // inner-ring proximity gate
  const c2 = peat.presentWithinRadius && waterScore >= 4;    // outer-radius peat + high water stress
  const c3 = hexFlags.tclInPeat;
  const c4 = hexFlags.tclInBothPeatAndWetland;
  const c5 = hexFlags.tclPeatOrWetlandInPA;
  return countTrue(c1, c2, c3, c4, c5);
}

function scoreWetland(
  wetland: WetlandData,
  waterScore: 1 | 2 | 3 | 4 | 5,
  hexFlags: HexCrossFlags,
): 0 | 1 | 2 | 3 | 4 | 5 {
  const c1 = wetland.presentWithinHalfRadius;                   // inner-ring proximity gate
  const c2 = wetland.presentWithinRadius && waterScore >= 4;    // outer-radius wetland + high water stress
  const c3 = hexFlags.tclInWetland;
  const c4 = hexFlags.tclInBothPeatAndWetland;
  const c5 = hexFlags.tclPeatOrWetlandInPA;
  return countTrue(c1, c2, c3, c4, c5);
}

// ─── Final score (raw sum 1–25) and risk tier ─────────────────────────────────

function computeFinalScore(s: RiskScores): number {
  return s.treeCoverLoss + s.waterStress + s.protectedArea + s.peatSoil + s.wetlandRisk;
}

// ─── Convergence score (weighted blend across radii) ─────────────────────────
//
// Problem: a flat per-radius score mechanically inflates at larger radii because
// more area = more binary flags, regardless of actual proximity to the mill.
//
// Solution: weight r30 most heavily (0.50), r50 moderately (0.30), r100 least
// (0.20). Add a proximity bonus (+1, capped at 25) when near-distance risk is at
// least as high as the far-distance score — rewarding mills where risk is truly
// concentrated close by. Flag "riskDiluted" when the landscape-only signal
// (r100) outpaces the near-distance signal (r30) by ≥6 points.

const RADIUS_WEIGHTS = { r30: 0.50, r50: 0.30, r100: 0.20 } as const;
const DILUTION_THRESHOLD = 6;

function computeConvergenceScore(
  finalByRadius: FinalScoreByRadius,
): { score: number; riskDiluted: boolean } {
  const weighted =
    finalByRadius.r30  * RADIUS_WEIGHTS.r30  +
    finalByRadius.r50  * RADIUS_WEIGHTS.r50  +
    finalByRadius.r100 * RADIUS_WEIGHTS.r100;

  // Proximity bonus: risk is concentrated near the mill
  const proximityBonus = finalByRadius.r30 >= finalByRadius.r100 ? 1 : 0;
  const score = Math.min(25, Math.round(weighted + proximityBonus));

  // Dilution flag: risk is landscape-driven, not near-mill
  const riskDiluted = (finalByRadius.r100 - finalByRadius.r30) >= DILUTION_THRESHOLD;

  return { score, riskDiluted };
}

const TIER_THRESHOLDS: Array<[number, RiskTier]> = [
  [5,  'LOW'],
  [10, 'LOW-MEDIUM'],
  [15, 'MEDIUM'],
  [19, 'MEDIUM-HIGH'],
  [23, 'HIGH'],
  [25, 'CRITICAL'],
];

function computeRiskTier(finalScore: number): RiskTier {
  for (const [threshold, tier] of TIER_THRESHOLDS) {
    if (finalScore <= threshold) return tier;
  }
  return 'CRITICAL';
}

// ─── Alerts (factual phrases — only true conditions are shown) ────────────────

export function computeAlerts(
  paData: ProtectedAreaData,
  hexFlags: HexCrossFlags,
  tclRings: TCLRings,
): MillAlerts {
  const allRings = tclRings.ring1 && tclRings.ring2 && tclRings.ring3 && tclRings.ring4;
  return {
    tclWithin5km:  tclRings.ring1,
    tclAllRings:   allRings,
    tclInStrictPA: paData.tclInStrictPA,
    tclInPeat:     hexFlags.tclInPeat,
    tclInWetland:  hexFlags.tclInWetland,
  };
}

// ─── Real profiles from compute_profiles.cjs output ─────────────────────────

interface TCLProfile extends TCLData {
  rings?: TCLRings;
}

interface PAProfile extends ProtectedAreaData {
  tclInStrictPA: boolean;
}

interface RadiusInputs {
  tcl:      TCLProfile;
  pa:       PAProfile;
  peat?:    PeatData;
  wetland?: WetlandData;
  water?:   WaterStressData;
  hexFlags?: HexCrossFlags;
}

interface RealProfile {
  r30:  RadiusInputs;
  r50:  RadiusInputs;
  r100: RadiusInputs;
}

const PROFILES = profilesJson as unknown as Record<string, RealProfile>;

const FALLBACK_RINGS:   TCLRings         = { ring1: false, ring2: false, ring3: false, ring4: false };
const FALLBACK_TCL:     TCLProfile       = { totalPctArea: 0, hasPostCutoff: false, annualPct: [0, 0, 0, 0], rings: FALLBACK_RINGS };
const FALLBACK_PA:      PAProfile        = { overlapPct: 0, hasRestrictive: false, restrictiveOverlapPct: 0, tclInStrictPA: false };
const FALLBACK_WATER:   WaterStressData  = { bws_cat: -1, bwd_cat: -1, iav_cat: -1 };
const FALLBACK_PEAT:    PeatData         = { presentWithinRadius: false, presentWithinHalfRadius: false };
const FALLBACK_WETLAND: WetlandData      = { presentWithinRadius: false, presentWithinHalfRadius: false, hasLoss: false, totalLossHa: 0 };
const FALLBACK_HEX:     HexCrossFlags    = { tclInPeat: false, tclInWetland: false, tclInBothPeatAndWetland: false, tclPeatOrWetlandInPA: false };

// ─── Mill enrichment ─────────────────────────────────────────────────────────
type RawMill = { type: string; features: Array<{ type: string; id?: number; geometry: MillFeature['geometry']; properties: { OBJECTID?: number; uml_id: string; rspo_statu: string } }> };
const rawMillsData = JSON.parse(rawMillsDataStr) as RawMill;

function buildMillFeature(f: RawMill['features'][number]): MillFeature {
  const umlId         = f.properties.uml_id;
  const rspoCertified = f.properties.rspo_statu === 'RSPO Certified';
  const profile       = PROFILES[umlId] ?? null;

  const r30  = profile?.r30  ?? { tcl: FALLBACK_TCL, pa: FALLBACK_PA };
  const r50  = profile?.r50  ?? { tcl: FALLBACK_TCL, pa: FALLBACK_PA };
  const r100 = profile?.r100 ?? { tcl: FALLBACK_TCL, pa: FALLBACK_PA };

  const getRings   = (tcl: TCLProfile): TCLRings => tcl.rings ?? FALLBACK_RINGS;
  const getHex     = (ri: RadiusInputs): HexCrossFlags => ri.hexFlags ?? FALLBACK_HEX;
  const getPeat    = (ri: RadiusInputs): PeatData      => ri.peat     ?? FALLBACK_PEAT;
  const getWetland = (ri: RadiusInputs): WetlandData   => ri.wetland  ?? FALLBACK_WETLAND;
  const getWater   = (ri: RadiusInputs): WaterStressData => ri.water  ?? FALLBACK_WATER;

  const pa30  = { ...FALLBACK_PA, ...r30.pa  } as PAProfile;
  const pa50  = { ...FALLBACK_PA, ...r50.pa  } as PAProfile;
  const pa100 = { ...FALLBACK_PA, ...r100.pa } as PAProfile;

  const water30  = getWater(r30);
  const water50  = getWater(r50);
  const water100 = getWater(r100);

  const waterScore30  = scoreWater(water30);
  const waterScore50  = scoreWater(water50);
  const waterScore100 = scoreWater(water100);

  const scoresByRadius: ScoresByRadius = {
    r30: {
      treeCoverLoss: scoreTCL(getRings(r30.tcl)),
      waterStress:   waterScore30,
      protectedArea: scorePA(pa30, rspoCertified),
      peatSoil:      scorePeat(getPeat(r30), waterScore30, getHex(r30)),
      wetlandRisk:   scoreWetland(getWetland(r30), waterScore30, getHex(r30)),
    },
    r50: {
      treeCoverLoss: scoreTCL(getRings(r50.tcl)),
      waterStress:   waterScore50,
      protectedArea: scorePA(pa50, rspoCertified),
      peatSoil:      scorePeat(getPeat(r50), waterScore50, getHex(r50)),
      wetlandRisk:   scoreWetland(getWetland(r50), waterScore50, getHex(r50)),
    },
    r100: {
      treeCoverLoss: scoreTCL(getRings(r100.tcl)),
      waterStress:   waterScore100,
      protectedArea: scorePA(pa100, rspoCertified),
      peatSoil:      scorePeat(getPeat(r100), waterScore100, getHex(r100)),
      wetlandRisk:   scoreWetland(getWetland(r100), waterScore100, getHex(r100)),
    },
  };

  const scores  = scoresByRadius.r50;
  const alerts  = computeAlerts(pa50, getHex(r50), getRings(r50.tcl));

  const finalScoreByRadius: FinalScoreByRadius = {
    r30:  computeFinalScore(scoresByRadius.r30),
    r50:  computeFinalScore(scores),
    r100: computeFinalScore(scoresByRadius.r100),
  };
  const riskTierByRadius: RiskTierByRadius = {
    r30:  computeRiskTier(finalScoreByRadius.r30),
    r50:  computeRiskTier(finalScoreByRadius.r50),
    r100: computeRiskTier(finalScoreByRadius.r100),
  };

  const { score: finalScore, riskDiluted } = computeConvergenceScore(finalScoreByRadius);
  const riskTier = computeRiskTier(finalScore);

  const properties: MillProperties = {
    ...f.properties,
    rspo_certified: rspoCertified,
    tclData:     r50.tcl,
    waterData:   water50,
    paData:      pa50,
    peatData:    getPeat(r50),
    wetlandData: getWetland(r50),
    hexFlags:    getHex(r50),
    scores,
    finalScore,
    riskTier,
    alerts,
    riskDiluted,
    scoresByRadius,
    finalScoreByRadius,
    riskTierByRadius,
  };

  return { type: 'Feature', geometry: f.geometry, properties };
}

export const millsDataBase: MillsGeoJSON = {
  type: 'FeatureCollection',
  features: rawMillsData.features.map(f => buildMillFeature(f)),
};
