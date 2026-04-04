# Supplier Risk Visualizer

> **Mockup / Portfolio Project** — This tool uses sample data for demonstration purposes only. Risk scores, rankings, and tier classifications are illustrative. Every company applies its own methodologies, thresholds, and business priorities when assessing supplier risk — the values shown here should not be used as a basis for real procurement decisions.

An interactive environmental risk screening tool for palm oil mill suppliers, built with React, MapLibre GL, and the VisQuill GDK spatial lens framework.

## Purpose

Demonstrates a risk-based supplier screening workflow for deforestation and ecosystem risk. Each mill is evaluated across five environmental dimensions within a configurable sourcing radius:

- **Tree Cover Loss** — GFW annual deforestation within sourcing buffer
- **Water Stress** — WRI Aqueduct basin-level stress indicators
- **Protected Areas** — WDPA overlap and IUCN category sensitivity
- **Peat Soil** — Peatland presence and proximity
- **Wetland** — Wetland extent and loss within the sourcing buffer

## Features

- **Regional mill risk matrix** — ranked overview of all suppliers by aggregate environmental score
- **Mill detail view** — zoom into any facility and explore live spatial data layers
- **VisQuill spatial lenses** — analysis lens locked to the selected mill showing risk scores by sourcing radius; exploration lens for querying deforestation trends (2021–2024) at any map location
- **Sourcing radius selector** — 30 / 50 / 100 km buffers around each mill
- **Ecosystem hex index** — H3 hexagon layer showing forest, wetland, and peatland extent across the region
- **Data layers**: ESA WorldCover land cover, GFW tree cover loss, Aqueduct water risk, WDPA protected areas, Aqueduct hydrological basins

## Setup

```bash
cd supplier-risk
npm install
npm run dev
```

The dev server proxies external tile services (ESA Terrascope, Global Forest Watch) to avoid CORS issues.

## Build & Deploy

```bash
npm run build
```

Configured for Netlify (`netlify.toml`) and Vercel (`vercel.json`). Both include proxy rewrites for the external tile services.

## Data Sources

| Layer | Source | Link |
|---|---|---|
| ESA WorldCover 2021 | Terrascope WMS | |
| Tree Cover Loss | Global Forest Watch | |
| Water Risk | WRI Aqueduct | |
| Protected Areas | WDPA — Protected Planet | |
| Hydrological Basins | WRI Aqueduct (HydroSHEDS) | |
| Peat soil extent | CIFOR Global Peatland Map | |
| Wetland extent | Global Wetlands Database | |
| Mill locations | RSPO data | 10 representative mills, Central America |

## Tech Stack

- React 19 + TypeScript
- MapLibre GL / react-map-gl
- VisQuill GDK + Blueprints (spatial lens SDK)
- H3-js (hexagonal spatial indexing)
- Turf.js (geometric operations)
- PMTiles (local vector tiles)
- Vite 8
