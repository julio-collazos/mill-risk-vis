/**
 * lenses.ts
 *
 * Defines the exploration-mode deforestation lens and the analysis-mode
 * risk score lens.
 *
 * Exploration: one draggable DataLens — 4 bars for 2021–2024 annual tree
 * cover loss (ha) queried from the local hexagons_index.json at the lens position.
 *
 * Analysis: one locked DataLens — 3 bars showing the risk score at each
 * sourcing radius (30 / 50 / 100 km) for the selected mill.
 *
 * Color scheme: amber → orange → red  (increasing alarm as loss continues)
 */

import { Boxes, Points, type RvgBox, type RvgGroup, Svg, Vectors } from "@visquill/visquill-gdk";
import { DataLens, type LensKit } from "@visquill/visquill-blueprints";

type BarPlotScheme       = DataLens.BarPlotScheme;
type DataLensScheme      = DataLens.DataLensScheme;
type DataLensTitleScheme = DataLens.DataLensTitleScheme;
type Lens                = LensKit.Lens;

// ── Year categories ───────────────────────────────────────────────────────────

const yearCategories: BarPlotScheme['categories'] = [
    { style: "cat-1", name: "2021" },
    { style: "cat-2", name: "2022" },
    { style: "cat-3", name: "2023" },
    { style: "cat-4", name: "2024" },
];

// ── Shared plot defaults ──────────────────────────────────────────────────────

const plot: BarPlotScheme = {
    type:      "bar-plot",
    aspect:    "tree-loss",
    offset:    15,
    barWidth:  14,
    barOffset: 10,
    barCaptions: { style: "bar-caption", autoFlip: true },
    valueLabels: { style: "value-label", autoFlip: true, distance: 8 },
    gridLines: {
        count:      3,
        offset:     24,
        style:      "@style stroke: rgba(255,255,255,0.15); stroke-width: 0.5px; fill:none",
        labelStyle: "grid-label",
        distance:   32,
    },
    baselineStyle: "baseline",
    categories:    yearCategories,
    maxExtent:     210,
};

// ── Shared lens defaults ──────────────────────────────────────────────────────

const sharedLens: Omit<DataLensScheme, "variable" | "title" | "plots" | "location" | "stylePrefix" | "initialAspect"> = {
    rimRadius:   110,
    radialSpan:  Math.PI / 4,   // wider arc for a single lens — more readable
    rimStyle:    "rim",
    innerRadius: 5,
    outerRadius: 260,
    onCollapse: {
        rimRadius:   25,
        innerRadius: 5,
        outerRadius: 5,
    },
};

const sharedTitle: Omit<DataLensTitleScheme, "text"> = {
    style:     "aspect-label",
    minLength: 40,
    minRadius: 40,
};

// ── Tree-loss icon (downward arrow through a tree) ────────────────────────────

const ICON_TREELOSS = `
<path d="M12 2L6 10h3l-3 10h12l-3-10h3z" stroke-width="1.5" stroke-linejoin="round"/>
<line x1="12" y1="20" x2="12" y2="22" stroke-width="2"/>
<path d="M8 16l4 4 4-4" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;

const ICON_SIZE = 36;

// ── Lens name export ──────────────────────────────────────────────────────────

export const EXPLORATION_LENS_NAMES = ["treeloss"] as const;
export type ExplorationLensName = typeof EXPLORATION_LENS_NAMES[number];

// ── Arc layout (single lens fills half-circle) ────────────────────────────────

export const equal: DataLens.ArcLayoutFunction = (
    component: Lens[],
    arcGap: number = 0.01
): DataLens.ArcAssignment[] => {
    if (component.length === 1) {
        return [{ lens: component[0], radialSpan: Math.PI, anchorAngle: -Math.PI / 2 }];
    }
    const gapTotal    = Math.PI * 2 * arcGap;
    const usableArc   = Math.PI * 2 - gapTotal;
    const spanPerLens = usableArc / component.length;
    const gapPerLens  = gapTotal  / component.length;
    let cursor = 0;
    return component.map(lens => {
        const assignment = { lens, radialSpan: spanPerLens, anchorAngle: -cursor };
        cursor += spanPerLens + gapPerLens;
        return assignment;
    });
};

// ── Internal helpers ──────────────────────────────────────────────────────────

function setupGroups(lensLayer: RvgGroup, lenses: DataLens.InteractiveLens[]) {
    DataLens.createProximityGroup(lensLayer, lenses, {
        threshold:         100,
        arcGap:            0.1,
        animationDuration: 800,
        arcLayout:         equal,
    });
    DataLens.createSnapGroup(lensLayer, lenses, {
        snapDistance:   50,
        unsnapDistance: 75,
    });
}

function createLensHome(
    background: RvgGroup,
    lens: DataLens.InteractiveLens,
    title: string,
    css: string,
    x: number,
    y: number
) {
    const box         = Boxes.box([x, y], 64, 64, background.visuals.box(css + "home")) as RvgBox;
    const labelAnchor = Points.moveDown(5, Boxes.bottomLeft(box));
    background.text.labelAt(title, labelAnchor, "home-label");
    DataLens.createDropBox(box, lens, { animationDuration: 800 });
    Vectors.copy(Boxes.center(box), lens.handle);

    // Inline SVG icon
    const group = Svg.get(background) as SVGGElement;
    const iconEl = document.createElementNS("http://www.w3.org/2000/svg", "g");
    iconEl.innerHTML = ICON_TREELOSS;
    const scale  = ICON_SIZE / 24;
    const offset = ICON_SIZE / 2;
    const center = Boxes.center(box);
    iconEl.setAttribute(
        "transform",
        `translate(${center.x - offset}, ${center.y - offset}) scale(${scale})`
    );
    iconEl.setAttribute("class", "sr-home-icon sr-treeloss-home-icon");
    iconEl.style.pointerEvents = "none";
    group.appendChild(iconEl);

    Svg.get(box).addEventListener("click", () => {
        Vectors.copy(Boxes.center(box), lens.handle);
    });

    return box;
}

// ── Analysis mode — risk score lens locked to mill ───────────────────────────

const radiusCategories: BarPlotScheme['categories'] = [
    { style: "cat-1", name: "30 km" },
    { style: "cat-2", name: "50 km" },
    { style: "cat-3", name: "100 km" },
];

const analysisPlot: BarPlotScheme = {
    type:      "bar-plot",
    aspect:    "tree-loss",   // reuse treeloss CSS color ramp
    offset:    15,
    barWidth:  14,
    barOffset: 10,
    barCaptions: { style: "bar-caption", autoFlip: true },
    valueLabels: { style: "value-label", autoFlip: true, distance: 8 },
    gridLines: {
        count:      5,
        offset:     24,
        style:      "@style stroke: rgba(255,255,255,0.15); stroke-width: 0.5px; fill:none",
        labelStyle: "grid-label",
        distance:   32,
    },
    baselineStyle: "baseline",
    categories:    radiusCategories,
    maxExtent:     210,
};

const analysisScheme: DataLensScheme = {
    ...sharedLens,
    variable:      "riskscore",
    title:         { ...sharedTitle, text: "Risk Score" },
    location:      { x: 200, y: 400 },
    stylePrefix:   "treeloss-",
    plots:         [analysisPlot],
    initialAspect: "tree-loss",
};

export const ANALYSIS_LENS_NAMES = ["riskscore"] as const;
export type AnalysisLensName = typeof ANALYSIS_LENS_NAMES[number];

export function runAnalysis(canvas: RvgGroup): DataLens.InteractiveLens[] {
    const lensLayer = canvas.layer();
    const lens = DataLens.createInteractiveLens(lensLayer, analysisScheme, "handle");
    return [lens];
}

// ── Exploration mode — single deforestation lens ──────────────────────────────

const explorationScheme: DataLensScheme = {
    ...sharedLens,
    variable:      "treeloss",
    title:         { ...sharedTitle, text: "Deforestation" },
    location:      { x: 60, y: 480 },
    stylePrefix:   "treeloss-",
    plots:         [plot],
    initialAspect: "tree-loss",
};

export function runExploration(canvas: RvgGroup): DataLens.InteractiveLens[] {
    const background = canvas.layer();
    const lensLayer  = canvas.layer();

    const lens = DataLens.createInteractiveLens(lensLayer, explorationScheme, "handle");
    const lenses = [lens];

    setupGroups(lensLayer, lenses);
    createLensHome(background, lens, "Deforestation", "treeloss-", 20, 420);

    return lenses;
}
