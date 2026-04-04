import { useState, useRef, useMemo, useEffect } from 'react';
import Map, { Marker, Source, Layer, Popup } from 'react-map-gl/maplibre';
import type { MapRef, MapLayerMouseEvent } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import * as turf from '@turf/turf';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { MillFeature, HoverInfo, ActiveLayers, LensLocation, MillsGeoJSON } from './types.ts';
import VisQuillOverlay from './VisQuillOverlay.tsx';
import RiskRanking from './components/RiskRanking.tsx';
import LayerToggle from './components/LayerToggle.tsx';
import MillInfoPanel from './components/MillInfoPanel.tsx';
import Legend from './components/Legend.tsx';
import MapTooltip from './components/MapTooltip.tsx';
import { millsDataBase } from './risk-data.ts';
import { getAllHexagonsAsGeoJSON } from './hex-query.ts';
import type { HexFeatureCollection } from './hex-query.ts';
import './components/panels.css';

const _pmtilesProtocol = new Protocol();
maplibregl.addProtocol('pmtiles', _pmtilesProtocol.tile);

// Central America AOI centre
const AOI_CENTER: [number, number] = [-88.5, 15.5];
const AOI_ZOOM = 7;

export default function App() {
  const mapRef = useRef<MapRef>(null);

  const [viewState, setViewState] = useState({ longitude: AOI_CENTER[0], latitude: AOI_CENTER[1], zoom: AOI_ZOOM });
  const [activeLayers, setActiveLayers] = useState<ActiveLayers>({
    esa: false, treeLoss: false, buffer: false,
    hexLoss: true, paLocal: false, basinsLocal: false,
  });
  const [activeRadius, setActiveRadius] = useState<30 | 50 | 100>(50);
  const [activeLenses, setActiveLenses] = useState<LensLocation[]>([]);
  const [selectedMill, setSelectedMill] = useState<MillFeature | null>(null);
  const [lensMode, setLensMode] = useState<'analysis' | 'exploration'>('analysis');
  const [hoveredMillId, setHoveredMillId] = useState<string | null>(null);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [paPopup,    setPaPopup]    = useState<{ longitude: number; latitude: number; properties: Record<string, unknown> } | null>(null);
  const [basinPopup, setBasinPopup] = useState<{ longitude: number; latitude: number; properties: Record<string, unknown> } | null>(null);
  const [hexPopup,   setHexPopup]   = useState<{ longitude: number; latitude: number; properties: Record<string, unknown> } | null>(null);
  const [globalHexGeoJSON, setGlobalHexGeoJSON] = useState<HexFeatureCollection | null>(null);
  const [millsData, setMillsData] = useState<MillsGeoJSON>(millsDataBase);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  useEffect(() => {
    const handler = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  const isMobile = windowWidth <= 480;

  const getMillCoords = (mill: MillFeature): [number, number] => {
    const coords = mill.geometry.coordinates;
    return (Array.isArray(coords[0]) ? coords[0] : coords) as [number, number];
  };

  const selectedCoords = selectedMill ? getMillCoords(selectedMill) : [0, 0] as [number, number];

  const mapMaxBounds = selectedMill
    ? [[selectedCoords[0] - 2.0, selectedCoords[1] - 2.0], [selectedCoords[0] + 2.0, selectedCoords[1] + 2.0]] as [[number, number], [number, number]]
    : undefined;

  const fitToRadius = (lng: number, lat: number, radiusKm: number, duration = 800) => {
    const circle = turf.circle([lng, lat], radiusKm, { steps: 64, units: 'kilometers' });
    const bbox = turf.bbox(circle);
    const mapPadding = isMobile
      ? { top: 60, bottom: Math.round(window.innerHeight * 0.65) + 20, left: 20, right: 20 }
      : 60;
    mapRef.current?.fitBounds(
      [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
      { padding: mapPadding, duration }
    );
  };

  const flyToMill = (mill: MillFeature) => {
    setSelectedMill(mill);
    setLensMode('analysis');
    setActiveLayers({ esa: true, treeLoss: true, buffer: true, hexLoss: false, paLocal: false, basinsLocal: false });
    const coords = getMillCoords(mill);
    fitToRadius(coords[0], coords[1], activeRadius, 1500);
  };

  const closeMillView = () => {
    setSelectedMill(null);
    setActiveLenses([]);
    setPaPopup(null);
    setBasinPopup(null);
    setHexPopup(null);
    setActiveLayers({ esa: false, treeLoss: false, buffer: false, hexLoss: true, paLocal: false, basinsLocal: false });
    const map = mapRef.current?.getMap();
    if (map) {
      map.setMaxBounds(null as any);
      map.setMinZoom(5);
    }
    mapRef.current?.flyTo({ center: AOI_CENTER, zoom: AOI_ZOOM, duration: 1500 });
  };

  const handleRadiusSelect = (r: 30 | 50 | 100) => {
    setActiveRadius(r);
    if (selectedMill) fitToRadius(selectedCoords[0], selectedCoords[1], r, 800);
  };

  const toggleLayer = (key: keyof ActiveLayers) => {
    setActiveLayers(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Load all hexagons globally
  useEffect(() => {
    getAllHexagonsAsGeoJSON()
      .then(data => setGlobalHexGeoJSON(data))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (lensMode === 'analysis' && selectedMill) {
      const coords = getMillCoords(selectedMill);
      setActiveLenses([{ lat: coords[1], lng: coords[0] }]);
    } else if (lensMode !== 'analysis') {
      setActiveLenses([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lensMode, selectedMill]);

  const effectiveRadiusKm = lensMode === 'exploration' ? 30 : activeRadius;

  const mapMaskGeometry = useMemo(() => {
    const worldPolygon = turf.bboxPolygon([-180, -90, 180, 90]);
    if (activeLenses.length === 0) return worldPolygon;
    const circles = activeLenses.map(loc =>
      turf.circle([loc.lng, loc.lat], effectiveRadiusKm, { steps: 64, units: 'kilometers' })
    );
    let combined: Feature<Polygon | MultiPolygon> = circles[0];
    for (let i = 1; i < circles.length; i++) {
      combined = turf.union(turf.featureCollection([combined, circles[i]])) ?? combined;
    }
    return turf.mask(combined, worldPolygon);
  }, [activeLenses, effectiveRadiusKm]);


  const pmBase = `pmtiles://${window.location.origin}`;

  const esaWmsUrl = '/terrascope-wms?service=WMS&request=GetMap&layers=WORLDCOVER_2021_MAP&styles=&format=image/png&transparent=true&version=1.1.1&width=256&height=256&srs=EPSG:3857&bbox={bbox-epsg-3857}';
  const treeCoverLossTilesUrl = '/gfw-tiles/umd_tree_cover_loss/v1.12/tcd_30/{z}/{x}/{y}.png';

  const handleMapClick = (evt: MapLayerMouseEvent) => {
    const millFeature  = evt.features?.find(f => f.layer.id === 'mills-layer');
    const paFeature    = evt.features?.find(f => f.layer.id === 'pa-local-fill');
    const basinFeature = evt.features?.find(f => f.layer.id === 'basins-local-fill');
    const hexFeature   = evt.features?.find(f => f.layer.id === 'hex-loss-fill');

    if (millFeature) {
      const uml_id = millFeature.properties?.uml_id as string | undefined;
      const fullMill = millsData.features.find(m => m.properties.uml_id === uml_id);
      if (fullMill) flyToMill(fullMill);
      setPaPopup(null); setBasinPopup(null); setHexPopup(null);
      return;
    }

    if (paFeature && selectedMill) {
      setPaPopup({ longitude: evt.lngLat.lng, latitude: evt.lngLat.lat, properties: paFeature.properties as Record<string, unknown> });
      setBasinPopup(null); setHexPopup(null);
      return;
    }

    if (basinFeature && selectedMill) {
      setBasinPopup({ longitude: evt.lngLat.lng, latitude: evt.lngLat.lat, properties: basinFeature.properties as Record<string, unknown> });
      setPaPopup(null); setHexPopup(null);
      return;
    }

    if (hexFeature) {
      setHexPopup({ longitude: evt.lngLat.lng, latitude: evt.lngLat.lat, properties: hexFeature.properties as Record<string, unknown> });
      setPaPopup(null); setBasinPopup(null);
      return;
    }

    setPaPopup(null); setBasinPopup(null); setHexPopup(null);
  };

  const handleMouseMove = (evt: MapLayerMouseEvent) => {
    if (selectedMill !== null) return;
    const feature = evt.features?.find(f => f.layer.id === 'mills-layer');
    if (feature) {
      setHoveredMillId(feature.properties?.uml_id ?? null);
      setHoverInfo({ x: evt.point.x, y: evt.point.y, feature: feature as unknown as MillFeature });
      if (mapRef.current) mapRef.current.getCanvas().style.cursor = 'pointer';
    } else {
      setHoveredMillId(null);
      setHoverInfo(null);
      if (mapRef.current) mapRef.current.getCanvas().style.cursor = '';
    }
  };

  const handleMouseLeave = () => {
    setHoveredMillId(null);
    setHoverInfo(null);
    if (mapRef.current) mapRef.current.getCanvas().style.cursor = '';
  };

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <VisQuillOverlay
        isVisible={selectedMill !== null && lensMode === 'exploration'}
        lensMode={lensMode}
        selectedMill={selectedMill}
        activeRadius={activeRadius}
        mapRef={mapRef}
        onActiveLensesChange={setActiveLenses}
        viewState={viewState}
      />

      {selectedMill === null && (
        <RiskRanking
          mills={millsData.features}
          hoveredMillId={hoveredMillId}
          onMillClick={flyToMill}
          onMillHover={setHoveredMillId}
        />
      )}

      {selectedMill !== null && (
        <>
          <LayerToggle activeLayers={activeLayers} onToggle={toggleLayer} />

          <div className="mode-toggle-bar">
            <button
              onClick={() => setLensMode('analysis')}
              style={{
                background:   lensMode === 'analysis' ? '#4ade9e' : 'rgba(15,23,35,0.85)',
                color:        lensMode === 'analysis' ? '#0a141e' : '#94a3b8',
                border:       '1px solid #4ade9e',
                borderRight:  'none',
                borderRadius: '6px 0 0 6px',
                padding:      '5px 14px',
                fontWeight:   600,
                cursor:       'pointer',
                fontSize:     '12px',
                letterSpacing:'0.03em',
              }}
            >Analysis</button>
            {!isMobile && (
              <button
                onClick={() => setLensMode('exploration')}
                style={{
                  background:   lensMode === 'exploration' ? '#f59e0b' : 'rgba(15,23,35,0.85)',
                  color:        lensMode === 'exploration' ? '#0a141e' : '#94a3b8',
                  border:       '1px solid #f59e0b',
                  borderRadius: '0 6px 6px 0',
                  padding:      '5px 14px',
                  fontWeight:   600,
                  cursor:       'pointer',
                  fontSize:     '12px',
                  letterSpacing:'0.03em',
                }}
              >Exploration</button>
            )}
            {isMobile && (
              <button
                style={{
                  background:   'rgba(15,23,35,0.85)',
                  color:        '#94a3b8',
                  border:       '1px solid #f59e0b',
                  borderRadius: '0 6px 6px 0',
                  padding:      '5px 14px',
                  fontWeight:   600,
                  cursor:       'default',
                  fontSize:     '12px',
                  letterSpacing:'0.03em',
                  opacity:      0.4,
                }}
                disabled
                title="Exploration mode not available on small screens"
              >Exploration</button>
            )}
          </div>

          <MillInfoPanel
            mill={selectedMill}
            onClose={closeMillView}
            activeRadius={activeRadius}
            onRadiusSelect={handleRadiusSelect}
          />
          <Legend activeLayers={activeLayers} />
        </>
      )}

      {selectedMill === null && hoverInfo && (
        <MapTooltip hoverInfo={hoverInfo} />
      )}

      <Map
        ref={mapRef}
        {...viewState}
        onMove={evt => setViewState(evt.viewState)}
        onClick={handleMapClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        interactiveLayerIds={['mills-layer', 'pa-local-fill', 'basins-local-fill', 'hex-loss-fill']}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
        minZoom={selectedMill ? 6 : 5}
        maxZoom={selectedMill ? 16 : 14}
        maxBounds={mapMaxBounds}
      >
        {selectedMill !== null && (
          <Marker longitude={selectedCoords[0]} latitude={selectedCoords[1]} anchor="bottom">
            <svg width="40" height="48" viewBox="0 0 40 48">
              <path
                d="M20 2C12.3 2 6 8.3 6 16c0 10 14 30 14 30s14-20 14-30c0-7.7-6.3-14-14-14z"
                fill="#4ade9e" stroke="#0a141e" strokeWidth="1.5"
              />
              <rect x="13" y="14" width="14" height="8" fill="#0a141e"/>
              <rect x="15" y="10" width="4"  height="4" fill="#0a141e"/>
              <rect x="21" y="11" width="3"  height="3" fill="#0a141e"/>
              <circle cx="20" cy="18" r="1.5" fill="#4ade9e"/>
            </svg>
          </Marker>
        )}

        {/* Global hexagon layer — always visible */}
        {globalHexGeoJSON && (
          <Source id="hex-loss" type="geojson" data={globalHexGeoJSON}>
            <Layer id="hex-loss-fill" type="fill"
              paint={{
                /* Color by dominant ecosystem type */
                'fill-color': [
                  'match', ['get', 'dominant'],
                  'f', '#166534',   // forest  → dark green
                  'w', '#0c4a6e',   // wetland → dark blue
                  '#78350f',        // peatland → dark amber
                ],
                'fill-opacity': 0.65,
                'fill-outline-color': 'rgba(255,255,255,0.08)',
              }}
              layout={{ visibility: activeLayers.hexLoss ? 'visible' : 'none' }} />
          </Source>
        )}

        {selectedMill !== null && (
          <>
            <Source id="esa-visuals" type="raster" tiles={[esaWmsUrl]} tileSize={256}>
              <Layer id="esa-raster-layer" type="raster"
                paint={{ 'raster-opacity': 0.5 }}
                layout={{ visibility: activeLayers.esa ? 'visible' : 'none' }} />
            </Source>

            <Source id="tree-loss" type="raster" tiles={[treeCoverLossTilesUrl]} tileSize={256}>
              <Layer id="tree-loss-layer" type="raster"
                paint={{ 'raster-opacity': 0.7 }}
                layout={{ visibility: activeLayers.treeLoss ? 'visible' : 'none' }} />
            </Source>

            <Source id="world-mask" type="geojson" data={mapMaskGeometry}>
              <Layer id="mask-fill" type="fill"
                paint={{ 'fill-color': '#0a141e', 'fill-opacity': 0.85 }}
                layout={{ visibility: activeLayers.buffer ? 'visible' : 'none' }} />
            </Source>

            <Source id="mill-buffers" type="geojson" data="/data/mill_buffers.geojson">
              <Layer id="buffer-outline" type="line"
                filter={['all',
                  ['==', ['get', 'uml_id'],    selectedMill?.properties.uml_id ?? ''],
                  ['==', ['get', 'buff_dist'], activeRadius],
                ]}
                paint={{
                  'line-color': '#d94f2b',
                  'line-dasharray': [3, 3],
                  'line-width': 2.0,
                  'line-opacity': 0.85,
                }}
                layout={{ visibility: activeLayers.buffer ? 'visible' : 'none' }} />
            </Source>

            <Source id="pa-local" type="vector" url={`${pmBase}/data/pa_aoi.pmtiles`}>
              <Layer id="pa-local-fill" type="fill" source-layer="PA_AOI"
                paint={{
                  'fill-color': '#22c55e',
                  'fill-opacity': ['case', ['in', ['get', 'IUCN_CAT'], ['literal', ['Ia', 'Ib', 'II']]], 0.45, 0.20],
                }}
                layout={{ visibility: activeLayers.paLocal ? 'visible' : 'none' }} />
            </Source>

            {paPopup && (
              <Popup
                longitude={paPopup.longitude}
                latitude={paPopup.latitude}
                anchor={isMobile ? 'top' : 'bottom'}
                onClose={() => setPaPopup(null)}
                closeButton={true}
                closeOnClick={false}
              >
                <div style={{ padding: '4px 2px', minWidth: '170px', fontFamily: 'sans-serif', color: '#0f172a' }}>
                  <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '6px', color: '#0f172a' }}>
                    {(paPopup.properties.NAME as string) || 'Protected Area'}
                  </div>
                  {!!paPopup.properties.IUCN_CAT && (
                    <div style={{ fontSize: '11px', marginBottom: '3px' }}>
                      <span style={{ color: '#475569' }}>IUCN:</span> <strong>{String(paPopup.properties.IUCN_CAT)}</strong>
                    </div>
                  )}
                  {!!paPopup.properties.DESIG && (
                    <div style={{ fontSize: '11px', marginBottom: '3px' }}>
                      <span style={{ color: '#475569' }}>Designation:</span> {String(paPopup.properties.DESIG)}
                    </div>
                  )}
                  {!!paPopup.properties.STATUS && (
                    <div style={{ fontSize: '11px' }}>
                      <span style={{ color: '#475569' }}>Status:</span> {String(paPopup.properties.STATUS)}
                    </div>
                  )}
                </div>
              </Popup>
            )}

            {basinPopup && (
              <Popup
                longitude={basinPopup.longitude}
                latitude={basinPopup.latitude}
                anchor={isMobile ? 'top' : 'bottom'}
                onClose={() => setBasinPopup(null)}
                closeButton={true}
                closeOnClick={false}
              >
                <div style={{ padding: '4px 2px', minWidth: '180px', fontFamily: 'sans-serif', color: '#0f172a' }}>
                  <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '6px', color: '#0f172a' }}>
                    {[basinPopup.properties.name_1, basinPopup.properties.name_0].filter(Boolean).map(String).join(', ') || 'Basin'}
                  </div>
                  {!!basinPopup.properties.bws_label && (
                    <div style={{ fontSize: '11px', marginBottom: '3px' }}>
                      <span style={{ color: '#475569' }}>Baseline Water Stress:</span> <strong>{String(basinPopup.properties.bws_label)}</strong>
                    </div>
                  )}
                  {!!basinPopup.properties.bwd_label && (
                    <div style={{ fontSize: '11px', marginBottom: '3px' }}>
                      <span style={{ color: '#475569' }}>Baseline Water Depletion:</span> <strong>{String(basinPopup.properties.bwd_label)}</strong>
                    </div>
                  )}
                  {!!basinPopup.properties.iav_label && (
                    <div style={{ fontSize: '11px' }}>
                      <span style={{ color: '#475569' }}>Interannual Variability:</span> <strong>{String(basinPopup.properties.iav_label)}</strong>
                    </div>
                  )}
                </div>
              </Popup>
            )}

            <Source id="basins-local" type="vector" url={`${pmBase}/data/basins_aoi.pmtiles`}>
              <Layer id="basins-local-fill" type="fill" source-layer="Basins_AOI_Countries"
                paint={{
                  'fill-color': [
                    'step',
                    ['max',
                      ['coalesce', ['get', 'bws_cat'], -1],
                      ['coalesce', ['get', 'bwd_cat'], -1],
                      ['coalesce', ['get', 'iav_cat'], -1],
                    ],
                    '#94a3b8',   // < 0  — no data
                    0, '#4575b4', // Low
                    1, '#91bfdb', // Low-Medium
                    2, '#fee090', // Medium-High
                    3, '#fc8d59', // High
                    4, '#d73027', // Extremely High
                  ],
                  'fill-opacity': 0.55,
                }}
                layout={{ visibility: activeLayers.basinsLocal ? 'visible' : 'none' }} />
            </Source>
          </>
        )}

        {hexPopup && (
          <Popup
            longitude={hexPopup.longitude}
            latitude={hexPopup.latitude}
            anchor={isMobile ? 'top' : 'bottom'}
            onClose={() => setHexPopup(null)}
            closeButton={true}
            closeOnClick={false}
          >
            <div style={{ padding: '4px 2px', minWidth: '190px', fontFamily: 'sans-serif', color: '#0f172a' }}>
              <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '6px', color: '#0f172a' }}>
                {{f:'Forest',w:'Wetland',p:'Peatland'}[hexPopup.properties.dominant as string] ?? 'Ecosystem'} Zone
              </div>
              <div style={{ fontSize: '11px', marginBottom: '4px', color: '#475569', borderBottom: '1px solid #e2e8f0', paddingBottom: '4px' }}>
                {String(hexPopup.properties.hex_id)}
              </div>
              <div style={{ fontSize: '11px', marginBottom: '3px' }}>
                <span style={{ color: '#475569' }}>Forest area:</span> {Number(hexPopup.properties.f).toFixed(0)} ha
              </div>
              <div style={{ fontSize: '11px', marginBottom: '3px' }}>
                <span style={{ color: '#475569' }}>Wetland area:</span> {Number(hexPopup.properties.w).toFixed(0)} ha
              </div>
              <div style={{ fontSize: '11px', marginBottom: '6px' }}>
                <span style={{ color: '#475569' }}>Peatland area:</span> {Number(hexPopup.properties.p).toFixed(0)} ha
              </div>
              {(['fl21','fl22','fl23','fl24'] as const).some(k => Number(hexPopup.properties[k]) > 0) && (
                <div style={{ fontSize: '11px', marginBottom: '2px', color: '#475569' }}>Forest loss (ha):</div>
              )}
              {(['fl21','fl22','fl23','fl24'] as const).map(k => Number(hexPopup.properties[k]) > 0 ? (
                <div key={k} style={{ fontSize: '11px', marginBottom: '1px', paddingLeft: '8px' }}>
                  <span style={{ color: '#475569' }}>20{k.slice(2)}:</span> {Number(hexPopup.properties[k]).toFixed(1)} ha
                </div>
              ) : null)}
              {(['wl21','wl22','wl23','wl24'] as const).some(k => Number(hexPopup.properties[k]) > 0) && (
                <div style={{ fontSize: '11px', marginTop: '4px', marginBottom: '2px', color: '#475569' }}>Wetland loss (ha):</div>
              )}
              {(['wl21','wl22','wl23','wl24'] as const).map(k => Number(hexPopup.properties[k]) > 0 ? (
                <div key={k} style={{ fontSize: '11px', marginBottom: '1px', paddingLeft: '8px' }}>
                  <span style={{ color: '#475569' }}>20{k.slice(2)}:</span> {Number(hexPopup.properties[k]).toFixed(1)} ha
                </div>
              ) : null)}
            </div>
          </Popup>
        )}

        <Source id="mills-source" type="geojson" data={millsData as unknown as GeoJSON.FeatureCollection}>
          <Layer
            id="mills-layer"
            type="circle"
            paint={{
              'circle-color': [
                'case',
                ['==', ['get', 'uml_id'], hoveredMillId ?? ''], '#ffffff',
                '#4ade9e'
              ],
              'circle-radius': selectedMill ? 4 : [
                'case',
                ['==', ['get', 'uml_id'], hoveredMillId ?? ''], 10,
                8
              ],
              'circle-stroke-width': 2,
              'circle-stroke-color': '#000'
            }}
          />
        </Source>
      </Map>
    </div>
  );
}
