import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import {
    Animate,
    Circles,
    Reactive,
    Svg,
    VisQuill,
} from "@visquill/visquill-gdk";
import { DataLens } from "@visquill/visquill-blueprints";
import {
    runExploration, runAnalysis,
    EXPLORATION_LENS_NAMES, ANALYSIS_LENS_NAMES,
} from "./lenses.ts";
import { queryCircle } from "./hex-query.ts";
import { FINAL_SCORE_CEILING } from "./risk-data.ts";
import type { LensLocation, MillFeature } from './types.ts';
import './risk.css';

interface VisQuillOverlayProps {
    isVisible:            boolean;
    lensMode:             'analysis' | 'exploration';
    selectedMill:         MillFeature | null;
    activeRadius:         30 | 50 | 100;
    mapRef:               RefObject<MapRef | null>;
    onActiveLensesChange: (lenses: LensLocation[]) => void;
    viewState:            object;
}

interface LensState {
    pinned:            boolean;
    lat:               number;
    lng:               number;
    isUpdatingFromMap: boolean;
}

interface VqState {
    mode:           'analysis' | 'exploration';
    lenses:         DataLens.InteractiveLens[];
    lensNames:      readonly string[];
    updateLensBars: (lens: DataLens.InteractiveLens, name: string) => void;
}

export default function VisQuillOverlay({
    isVisible,
    lensMode,
    selectedMill,
    activeRadius,
    mapRef,
    onActiveLensesChange,
    viewState,
}: VisQuillOverlayProps) {
    const containerRef  = useRef<HTMLDivElement>(null);
    const vqState       = useRef<VqState | null>(null);
    const lensStateRef  = useRef<LensState[]>([]);
    const selectedMillRef = useRef<MillFeature | null>(null);

    // keep selectedMillRef current without triggering reinit
    useEffect(() => { selectedMillRef.current = selectedMill; }, [selectedMill]);

    // ── Reinitialize VisQuill whenever lensMode changes ───────────────────────
    useEffect(() => {
        if (!containerRef.current) return;

        containerRef.current.innerHTML = '';
        vqState.current      = null;
        lensStateRef.current = [];

        const container = containerRef.current;

        if (lensMode === 'analysis') {
            container.classList.add('sr-analysis-mode');
            container.classList.remove('sr-exploration-mode');
        } else {
            container.classList.add('sr-exploration-mode');
            container.classList.remove('sr-analysis-mode');
        }

        const rvg        = VisQuill.create(container, "sr-");
        const lensCanvas = rvg.canvas.layer();

        if (lensMode === 'analysis') {
            // ── Analysis: single lens locked to selected mill ─────────────────
            const lenses    = runAnalysis(lensCanvas);
            const lensNames = ANALYSIS_LENS_NAMES;
            const lens      = lenses[0];

            // Position handle at mill screen coords immediately
            const map = mapRef?.current?.getMap();
            if (map && selectedMillRef.current) {
                const coords = selectedMillRef.current.geometry.coordinates;
                const [lng, lat] = (Array.isArray(coords[0]) ? coords[0] : coords) as [number, number];
                const screenPos  = map.project([lng, lat]);
                lens.handle.x    = screenPos.x;
                lens.handle.y    = screenPos.y;
            }

            function updateLensBars(_lens: DataLens.InteractiveLens, _name: string) {
                const mill = selectedMillRef.current;
                if (!mill) return;
                const { finalScoreByRadius } = mill.properties;
                const scores = [
                    finalScoreByRadius.r30,
                    finalScoreByRadius.r50,
                    finalScoreByRadius.r100,
                ];
                const MAX_BAR = 150;
                _lens.plots[0].bars.forEach((bar, i) => {
                    const val = scores[i] ?? 0;
                    Animate.follow(bar.height, (val / FINAL_SCORE_CEILING) * MAX_BAR);
                    if (bar.valueLabel) bar.valueLabel.value = String(val);
                });
            }

            // Initial bar population
            updateLensBars(lens, lensNames[0]);

            vqState.current = { mode: 'analysis', lenses, lensNames, updateLensBars };

        } else {
            // ── Exploration: draggable deforestation lens ─────────────────────
            const decoLayer  = rvg.canvas.layer();
            const lenses     = runExploration(lensCanvas);
            const lensNames  = EXPLORATION_LENS_NAMES;
            const lensRadius = lensCanvas.values.real(110);

            lenses.forEach(lens => {
                const rim = lens.layer.visuals.circle(
                    "@style stroke: #ef4444; stroke-width: 2px; stroke-dasharray: 5 5; fill: none; opacity: 0.7"
                );
                Reactive.do([lens.radius, lens.size], () => {
                    Circles.circleAt([0, 0], Math.max((lens.radius.value - 10) * lens.size.value, 30), rim);
                });
            });

            const onceLabel = decoLayer.text.label(
                "🖐 Drag the lens",
                "sr-one-time-instruction"
            );
            Svg.get(onceLabel).style.fill = 'rgba(148, 163, 184, 0.9)';
            const lens0 = lenses[0];
            Reactive.do([lens0.handle], () => {
                if (onceLabel.mounted.value) {
                    onceLabel.x = lens0.handle.x;
                    onceLabel.y = lens0.handle.y + 70;
                }
            });
            for (const lens of lenses) {
                Reactive.do([lens.location], () => { onceLabel.mounted.value = false; }, false);
            }

            lenses.forEach((lens, i) => {
                lensStateRef.current[i] = { pinned: false, lat: 0, lng: 0, isUpdatingFromMap: false };

                Reactive.do([lens.handle, lens.size], () => {
                    lens.expandedRadius.value = Math.max(lensRadius.value + 10, 150);

                    if (lens.size.value < 0.5) {
                        if (lensStateRef.current[i].pinned) {
                            lensStateRef.current[i].pinned = false;
                            reportActiveLenses();
                        }
                        return;
                    }

                    if (lensStateRef.current[i].isUpdatingFromMap) return;

                    try {
                        const map = mapRef?.current?.getMap();
                        if (map) {
                            const coords = map.unproject([lens.handle.x, lens.handle.y]);
                            lensStateRef.current[i] = {
                                ...lensStateRef.current[i],
                                pinned: true,
                                lat:    coords.lat,
                                lng:    coords.lng,
                            };
                            reportActiveLenses();
                        }
                    } catch (_e) { /* map not ready yet */ }

                    updateLensBars(lens, lensNames[i]);
                });
            });

            vqState.current = { mode: 'exploration', lenses, lensNames, updateLensBars };

            function reportActiveLenses() {
                if (!onActiveLensesChange) return;
                const active = lensStateRef.current
                    .filter(s => s.pinned)
                    .map(s => ({ lat: s.lat, lng: s.lng }));
                onActiveLensesChange(active);
            }

            function updateLensBars(lens: DataLens.InteractiveLens, _name: string) {
                if (lens.size.value < 0.5) return;
                const map = mapRef?.current?.getMap();
                let loc: LensLocation = { lat: 20, lng: 0 };
                if (map) {
                    try {
                        const coords = map.unproject([lens.handle.x, lens.handle.y]);
                        loc = { lat: coords.lat, lng: coords.lng };
                    } catch (_e) { /* map not ready yet */ }
                }
                queryCircle(loc.lat, loc.lng, 30)
                    .then((result) => {
                        if (lens.size.value < 0.5) return;
                        const areas   = [result.fl21, result.fl22, result.fl23, result.fl24];
                        const ceiling = Math.max(...areas, 10) * 1.2;
                        lens.plots[0].bars.forEach((bar, i) => {
                            const raw = areas[i] ?? 0;
                            Animate.follow(bar.height, (raw / ceiling) * 150);
                            if (bar.valueLabel) bar.valueLabel.value = raw.toFixed(1) + ' ha';
                        });
                    })
                    .catch((err: unknown) => console.warn('Hex query failed:', err));
            }
        }

        return () => {
            if (containerRef.current) containerRef.current.innerHTML = '';
            vqState.current      = null;
            lensStateRef.current = [];
        };

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lensMode]);

    // ── Update analysis bars when mill or radius changes ──────────────────────
    useEffect(() => {
        if (!vqState.current || vqState.current.mode !== 'analysis') return;
        const { lenses, lensNames, updateLensBars } = vqState.current;

        // Reposition handle to current mill screen position
        const map = mapRef?.current?.getMap();
        if (map && selectedMill) {
            const coords     = selectedMill.geometry.coordinates;
            const [lng, lat] = (Array.isArray(coords[0]) ? coords[0] : coords) as [number, number];
            const screenPos  = map.project([lng, lat]);
            lenses[0].handle.x = screenPos.x;
            lenses[0].handle.y = screenPos.y;
        }

        updateLensBars(lenses[0], lensNames[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedMill, activeRadius]);

    // ── Sync handle/bars to map pan & zoom ────────────────────────────────────
    useEffect(() => {
        if (!vqState.current) return;
        const { mode, lenses, lensNames, updateLensBars } = vqState.current;
        const map = mapRef?.current?.getMap();
        if (!map) return;

        if (mode === 'analysis') {
            const mill = selectedMillRef.current;
            if (!mill) return;
            const coords     = mill.geometry.coordinates;
            const [lng, lat] = (Array.isArray(coords[0]) ? coords[0] : coords) as [number, number];
            const screenPos  = map.project([lng, lat]);
            lenses[0].handle.x = screenPos.x;
            lenses[0].handle.y = screenPos.y;
            updateLensBars(lenses[0], lensNames[0]);
        } else {
            lenses.forEach((lens, i) => {
                const state = lensStateRef.current[i];
                if (state && state.pinned && lens.size.value > 0.5) {
                    state.isUpdatingFromMap = true;
                    const screenPos    = map.project([state.lng, state.lat]);
                    lens.handle.x      = screenPos.x;
                    lens.handle.y      = screenPos.y;
                    state.isUpdatingFromMap = false;
                    updateLensBars(lens, lensNames[i]);
                }
            });
        }
    }, [viewState, mapRef]);

    return (
        <div
            ref={containerRef}
            style={{
                position:      'absolute',
                top: 0, left:  0,
                width:         '100%',
                height:        '100%',
                zIndex:        20,
                pointerEvents: 'none',
                display:       isVisible ? 'block' : 'none',
            }}
        />
    );
}
