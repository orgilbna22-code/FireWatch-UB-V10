import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  ArrowUpDown,
  ChevronDown,
  Flame,
  Globe,
  Layers,
  Map as MapIcon,
  MapPin,
  Satellite,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { DistrictData, KhorooData, Language, ViewMode } from '../../types';
import {
  UB_CENTER_COORDS,
  UB_DISTRICTS,
  UB_FIRE_STATIONS,
  DEMO_HISTORICAL_INCIDENTS,
  TOTAL_HISTORICAL_INCIDENTS,
  UB_KHOROOS,
} from '../../data/ubGeoData';
import { AreaAnalysisPanel } from './AreaAnalysisPanel';
import { Tactical3DOverlay } from './Tactical3DOverlay';
import { Tactical3DHud } from './Tactical3DHud';
import {
  HEAT_LEGEND_GRADIENT,
  ThermalHeatLayer,
  type HeatHoverSample,
  type HeatPoint,
} from './ThermalHeatLayer';
import { getTranslation } from '../../i18n/translations';
import { escapeHtml } from '../../utils/safeHtml';
import { khorooLabel, locationConfidenceLabel, riskLevelLabel, stationCodeLabel } from '../../i18n/labels';
import { useLiveWeather } from '../../hooks/liveWeather';
import { useFireRiskState } from '../../hooks/useFireRiskState';
import { mergeSpatialHeatSources } from '../../utils/riskEngine';
import {
  DEFAULT_TACTICAL_ASSUMPTIONS,
  type TacticalScenarioAssumptions,
} from '../../data/tacticalScenarioConfig';
import {
  buildTactical3DScene,
  generateCityBlueFootprints,
  mapScaleLabel,
} from '../../utils/tactical3dData';

interface RiskMapProps {
  language: Language;
  viewMode: ViewMode;
  selectedDistrictId?: string | null;
  onSelectDistrict?: (districtId: string) => void;
  onNavigateToDetail?: (districtId: string) => void;
}

type MapTileStyle = 'satellite' | 'street' | 'light' | 'topo' | 'dark' | 'osm' | 'tactical3d';
type NonSatelliteStyle = Exclude<MapTileStyle, 'satellite'>;
type DistrictSortMode = 'default' | 'risk_desc' | 'alpha';

interface BasemapOption {
  id: NonSatelliteStyle;
  icon: string;
  labelMn: string;
  shortMn: string;
  labelEn: string;
  shortEn: string;
  descMn: string;
  descEn: string;
  swatch: string;
}

const BASEMAP_OPTIONS: BasemapOption[] = [
  {
    id: 'tactical3d',
    icon: '🛰️',
    labelMn: '3D Тактик (Аксонометрик)',
    shortMn: '3D Тактик',
    labelEn: '3D Tactical (2.5D)',
    shortEn: '3D Tactical',
    descMn: '2.5D барилга, таамагласан радиус ба ойролцоо чиглэл',
    descEn: 'Axonometric 3D massing, assumed zone & rough corridor',
    swatch: 'linear-gradient(135deg, #060b16 0%, #172554 58%, #FF633C 100%)',
  },
  {
    id: 'osm',
    icon: '🗺️',
    labelMn: 'Энгийн зураг (OSM)',
    shortMn: 'OSM',
    labelEn: 'Street Map (OSM)',
    shortEn: 'OSM',
    descMn: 'Монгол нэршил, гудамж, гол горхи',
    descEn: 'Detailed streets & Mongolian labels',
    swatch: 'linear-gradient(135deg, #f3f4f6 0%, #bbf7d0 55%, #fde68a 100%)',
  },
  {
    id: 'light',
    icon: '✨',
    labelMn: 'Цэвэр GIS (Саарал)',
    shortMn: 'Цэвэр',
    labelEn: 'Clean GIS (Light)',
    shortEn: 'Clean',
    descMn: 'Дулааны бүс хамгийн тод харагдана',
    descEn: 'Minimal canvas for maximum heat clarity',
    swatch: 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)',
  },
  {
    id: 'street',
    icon: '🏙️',
    labelMn: 'Хотын зам (Esri)',
    shortMn: 'Зам',
    labelEn: 'City Roads (Esri)',
    shortEn: 'Streets',
    descMn: 'Авто зам, барилгын тод төлөвлөлт',
    descEn: 'Clean urban road & block layout',
    swatch: 'linear-gradient(135deg, #f8f4ea 0%, #dbeafe 60%, #fde68a 100%)',
  },
  {
    id: 'topo',
    icon: '⛰️',
    labelMn: 'Уул зүйн (Топо)',
    shortMn: 'Топо',
    labelEn: 'Topographic',
    shortEn: 'Topo',
    descMn: 'Уул, хөндий, өндөрлөгийн зураглал',
    descEn: 'Terrain relief, valleys & contours',
    swatch: 'linear-gradient(135deg, #ecfccb 0%, #fef3c7 55%, #cbd5e1 100%)',
  },
  {
    id: 'dark',
    icon: '🌙',
    labelMn: 'Шөнийн зураг',
    shortMn: 'Шөнийн',
    labelEn: 'Night Tactical',
    shortEn: 'Dark',
    descMn: 'Бараан дэвсгэр дээр тод голомт',
    descEn: 'Dark slate base for vivid heat contrast',
    swatch: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
  },
];

/**
 * Leaflet's fly animation divides by the container size, so moving the camera
 * before the map has been measured throws "Invalid LatLng object: (NaN, NaN)".
 */
const focusMap = (map: L.Map, center: [number, number], zoom: number, duration = 0.42) => {
  if (!Number.isFinite(center[0]) || !Number.isFinite(center[1])) return;
  const size = map.getSize();
  if (size.x < 8 || size.y < 8) {
    map.setView(center, zoom, { animate: false });
    return;
  }
  map.flyTo(center, zoom, { duration });
};

// Curated urban fire-risk concentration corridors used alongside all 204 khoroos
const UB_HEATMAP_HOTSPOTS: [number, number, number, string, number][] = [
  [47.9450, 106.7850, 1500, 'Баянхошуу гэр хороолол', 79],
  [47.9300, 106.7450, 1350, 'Толгойт уулын бэл', 78],
  [47.9400, 107.0100, 1450, 'Дарь-Эх, Ганц худаг', 77],
  [47.9150, 107.0350, 1250, 'Амгалан, Цайз зах', 74],
  [47.9550, 106.9050, 1200, 'Дэнжийн 1000, Зурагт', 75],
  [47.9750, 106.9150, 1150, '7 буудал, Чингэлтэй уул', 73],
  [47.9480, 106.9350, 1100, '32-ын тойрог, Бэлх', 68],
  [47.8850, 106.8450, 1250, 'Яармаг, Нисэх гэр хороолол', 67],
  [47.9180, 106.8750, 1050, 'Гандан, 3-4 хороолол ар', 62],
  [47.9250, 107.0850, 1200, 'Шар хад, Улиастай', 76],
];

const HOTSPOT_NAME_EN: Record<string, string> = {
  'Баянхошуу гэр хороолол': 'Bayankhoshuu ger belt',
  'Толгойт уулын бэл': 'Tolgoit hill base',
  'Дарь-Эх, Ганц худаг': 'Dari-Ekh, Gants Khudag',
  'Амгалан, Цайз зах': 'Amgalan, Tsaiz market',
  'Дэнжийн 1000, Зурагт': 'Denj 1000, Zuragt',
  '7 буудал, Чингэлтэй уул': '7 Buudal, Chingeltei hill',
  '32-ын тойрог, Бэлх': 'Ring 32, Belkh',
  'Яармаг, Нисэх гэр хороолол': 'Yarmag, Nisekh ger belt',
  'Гандан, 3-4 хороолол ар': 'Gandan, khoroo 3-4 rear',
  'Шар хад, Улиастай': 'Shar Khad, Uliastai',
};

const hotspotNameEn = (mn: string): string => HOTSPOT_NAME_EN[mn] ?? mn;

export const RiskMap: React.FC<RiskMapProps> = ({
  language,
  viewMode: _viewMode,
  selectedDistrictId,
  onSelectDistrict,
  onNavigateToDetail,
}) => {
  const t = getTranslation(language);
  const isMn = language === 'mn';
  const live = useLiveWeather();
  const fireState = useFireRiskState();
  const liveDistricts = fireState.districts;
  const liveKhoroos = fireState.khoroos;

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  const baseTileLayerRef = useRef<L.TileLayer | null>(null);
  const labelsTileLayerRef = useRef<L.TileLayer | null>(null);

  const [activeDistrictId, setActiveDistrictId] = useState<string | null>(() => {
    return (UB_DISTRICTS.find((d) => d.id === selectedDistrictId) || UB_DISTRICTS[0]).id;
  });
  const [selectedKhorooId, setSelectedKhorooId] = useState<string | null>(null);

  const activeDistrict = useMemo(
    () => (activeDistrictId ? liveDistricts.find((d) => d.id === activeDistrictId) ?? null : null),
    [activeDistrictId, liveDistricts]
  );
  const selectedKhoroo = useMemo(
    () => (selectedKhorooId ? liveKhoroos.find((k) => k.id === selectedKhorooId) ?? null : null),
    [selectedKhorooId, liveKhoroos]
  );
  const setActiveDistrict = useCallback((d: DistrictData | null) => {
    setActiveDistrictId(d ? d.id : null);
  }, []);
  const setSelectedKhoroo = useCallback((kh: KhorooData | null) => {
    setSelectedKhorooId(kh ? kh.id : null);
  }, []);

  const [isPanelOpen, setIsPanelOpen] = useState<boolean>(true);
  const [showMobileLegend, setShowMobileLegend] = useState<boolean>(false);

  const [tileStyle, setTileStyle] = useState<MapTileStyle>('light');
  const [lastMapStyle, setLastMapStyle] = useState<NonSatelliteStyle>('light');
  const [is3DExtruded, setIs3DExtruded] = useState<boolean>(true);
  const [scenarioStarted, setScenarioStarted] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.location.search.includes('autostart=1')
  );
  const [assumptions, setAssumptions] = useState<TacticalScenarioAssumptions>(
    () => ({ ...DEFAULT_TACTICAL_ASSUMPTIONS })
  );
  const [osmBuildingCount, setOsmBuildingCount] = useState<number>(0);
  const coordTextRef = useRef<HTMLDivElement | null>(null);
  const hoverReadoutRef = useRef<HTMLSpanElement | null>(null);
  const [showBasemapDropdown, setShowBasemapDropdown] = useState(false);
  const [showDistrictFilter, setShowDistrictFilter] = useState(false);
  const [khorooMode, setKhorooMode] = useState<'district_only' | 'all' | 'none'>('none');
  const [showStations, setShowStations] = useState(false);
  const [showStationBuffers, setShowStationBuffers] = useState(false);
  const [showIncidents, setShowIncidents] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [overlayOrder, setOverlayOrder] = useState<Array<'heatmap' | 'khoroos' | 'stations' | 'buffers' | 'incidents'>>([]);
  const [layerLimitNotice, setLayerLimitNotice] = useState<string | null>(null);
  const [showLayersDropdown, setShowLayersDropdown] = useState(false);
  const initialDist = UB_DISTRICTS.find((d) => d.id === selectedDistrictId) || UB_DISTRICTS[0];
  const [mapZoom, setMapZoom] = useState<number>(initialDist ? 12 : 11);
  const prevSyncedDistrictIdRef = useRef<string | null | undefined>(selectedDistrictId);

  const showOverlayNotice = useCallback(
    (msgMn: string, msgEn: string) => {
      setLayerLimitNotice(isMn ? msgMn : msgEn);
      window.setTimeout(() => {
        setLayerLimitNotice((cur) => (cur === (isMn ? msgMn : msgEn) ? null : cur));
      }, 3600);
    },
    [isMn]
  );

  const setOverlayState = useCallback(
    (
      key: 'heatmap' | 'khoroos' | 'stations' | 'buffers' | 'incidents',
      enable: boolean,
      khorooNextMode: 'district_only' | 'all' | 'none' = 'district_only'
    ) => {
      if (!enable) {
        if (key === 'heatmap') setShowHeatmap(false);
        if (key === 'khoroos') setKhorooMode('none');
        if (key === 'stations') setShowStations(false);
        if (key === 'buffers') setShowStationBuffers(false);
        if (key === 'incidents') setShowIncidents(false);
        setOverlayOrder((prev) => prev.filter((item) => item !== key));
        return;
      }

      const activeNow = overlayOrder.filter((item) => item !== key);
      let nextOrder = [...activeNow, key];
      if (nextOrder.length > 2) {
        const dropped = nextOrder[0];
        nextOrder = nextOrder.slice(1);
        if (dropped === 'heatmap') setShowHeatmap(false);
        if (dropped === 'khoroos') setKhorooMode('none');
        if (dropped === 'stations') setShowStations(false);
        if (dropped === 'buffers') setShowStationBuffers(false);
        if (dropped === 'incidents') setShowIncidents(false);
        showOverlayNotice(
          'Цэвэр харагдац: дээд тал нь 2 давхарга зэрэг харуулна (өмнөх давхаргыг унтраалаа).',
          'Max 2 overlays active for map clarity — oldest overlay was turned off.'
        );
      }

      if (key === 'heatmap') setShowHeatmap(true);
      if (key === 'khoroos') setKhorooMode(khorooNextMode);
      if (key === 'stations') setShowStations(true);
      if (key === 'buffers') setShowStationBuffers(true);
      if (key === 'incidents') setShowIncidents(true);
      setOverlayOrder(nextOrder);
    },
    [overlayOrder, showOverlayNotice]
  );

  const [sortBy, setSortBy] = useState<DistrictSortMode>('risk_desc');
  const layersDropdownRef = useRef<HTMLDivElement | null>(null);
  const basemapDropdownRef = useRef<HTMLDivElement | null>(null);
  const districtFilterRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!showLayersDropdown && !showBasemapDropdown && !showDistrictFilter) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (showLayersDropdown && layersDropdownRef.current && !layersDropdownRef.current.contains(target)) {
        setShowLayersDropdown(false);
      }
      if (showBasemapDropdown && basemapDropdownRef.current && !basemapDropdownRef.current.contains(target)) {
        setShowBasemapDropdown(false);
      }
      if (showDistrictFilter && districtFilterRef.current && !districtFilterRef.current.contains(target)) {
        setShowDistrictFilter(false);
      }
    };
    const onKeyEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowLayersDropdown(false);
        setShowBasemapDropdown(false);
        setShowDistrictFilter(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKeyEsc);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKeyEsc);
    };
  }, [showLayersDropdown, showBasemapDropdown, showDistrictFilter]);

  const [searchQuery, setSearchQuery] = useState('');
  const [geoLocating, setGeoLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<{
    type: 'district' | 'khoroo';
    item: DistrictData | KhorooData;
  }[]>([]);

  const districtsLayerGroup = useRef<L.LayerGroup | null>(null);
  const districtPolygonsRef = useRef<Map<string, L.Polygon>>(new Map());
  const hoveredDistrictIdRef = useRef<string | null>(null);
  const khoroosLayerGroup = useRef<L.LayerGroup | null>(null);
  const stationsLayerGroup = useRef<L.LayerGroup | null>(null);
  const stationBuffersLayerGroup = useRef<L.LayerGroup | null>(null);
  const incidentsLayerGroup = useRef<L.LayerGroup | null>(null);
  const userLocationLayerGroup = useRef<L.LayerGroup | null>(null);

  // 1. Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const startDist = UB_DISTRICTS.find((d) => d.id === selectedDistrictId) || UB_DISTRICTS[0];
    const startCenter = startDist ? startDist.center : UB_CENTER_COORDS;
    const startZoom = startDist ? 12 : 11;

    const map = L.map(mapContainerRef.current, {
      center: startCenter,
      zoom: startZoom,
      zoomControl: false,
      minZoom: 8,
      maxZoom: 18,
      preferCanvas: true,
      zoomAnimation: true,
      markerZoomAnimation: true,
      fadeAnimation: true,
      wheelDebounceTime: 35,
      wheelPxPerZoomLevel: 65,
    });

    const writeCoordsDom = (lat: number, lng: number) => {
      if (coordTextRef.current) {
        coordTextRef.current.textContent = `${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E`;
      }
    };

    map.on('zoomend', () => {
      const z = map.getZoom();
      setMapZoom((prev) => (prev === z ? prev : z));
    });
    map.on('mousemove', (ev: L.LeafletMouseEvent) => {
      writeCoordsDom(ev.latlng.lat, ev.latlng.lng);
    });
    map.on('moveend', () => {
      const c = map.getCenter();
      writeCoordsDom(c.lat, c.lng);
    });

    const labelsPane = map.createPane('labelsPane');
    labelsPane.style.zIndex = '450';
    labelsPane.style.pointerEvents = 'none';

    const baseTile = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Tiles &copy; Esri Light Gray',
        maxZoom: 16,
        keepBuffer: 2,
      }
    ).addTo(map);

    const labelsTile = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 16, opacity: 0.9, pane: 'labelsPane', keepBuffer: 2 }
    ).addTo(map);

    baseTileLayerRef.current = baseTile;
    labelsTileLayerRef.current = labelsTile;

    L.control.zoom({ position: 'bottomleft' }).addTo(map);

    districtsLayerGroup.current = L.layerGroup().addTo(map);
    stationBuffersLayerGroup.current = L.layerGroup().addTo(map);
    khoroosLayerGroup.current = L.layerGroup().addTo(map);
    stationsLayerGroup.current = L.layerGroup().addTo(map);
    incidentsLayerGroup.current = L.layerGroup().addTo(map);
    userLocationLayerGroup.current = L.layerGroup().addTo(map);

    mapInstanceRef.current = map;
    setMapInstance(map);

    const initTimer = window.setTimeout(() => map.invalidateSize({ animate: false }), 120);

    let resizeRaf: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    if (mapContainerRef.current && window.ResizeObserver) {
      resizeObserver = new ResizeObserver(() => {
        if (resizeRaf !== null) return;
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf = null;
          map.invalidateSize({ animate: false });
        });
      });
      resizeObserver.observe(mapContainerRef.current);
    }

    return () => {
      window.clearTimeout(initTimer);
      if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
      if (resizeObserver) resizeObserver.disconnect();
      map.remove();
      mapInstanceRef.current = null;
      setMapInstance(null);
    };
  }, []);

  // 2. Tile Provider Switching
  const handleTileChange = (style: MapTileStyle) => {
    setTileStyle(style);
    if (style !== 'satellite') {
      setLastMapStyle(style);
    }
    setShowBasemapDropdown(false);

    const map = mapInstanceRef.current;
    if (!map) return;

    // Cancel any active flyTo transition before replacing GridLayer so Leaflet never stalls tile levels
    map.stop();

    if (baseTileLayerRef.current) map.removeLayer(baseTileLayerRef.current);
    if (labelsTileLayerRef.current) {
      map.removeLayer(labelsTileLayerRef.current);
      labelsTileLayerRef.current = null;
    }

    let base: L.TileLayer;
    if (style === 'satellite') {
      base = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { attribution: 'Tiles &copy; Esri World Imagery', maxZoom: 18 }
      ).addTo(map);

      const labels = L.tileLayer(
        'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 18, opacity: 0.92, pane: 'labelsPane' }
      ).addTo(map);
      labelsTileLayerRef.current = labels;
    } else if (style === 'street') {
      base = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
        { attribution: 'Tiles &copy; Esri World Street Map', maxZoom: 18 }
      ).addTo(map);
    } else if (style === 'light') {
      base = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        { attribution: 'Tiles &copy; Esri Light Gray', maxZoom: 16 }
      ).addTo(map);

      const labels = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 16, opacity: 0.9, pane: 'labelsPane' }
      ).addTo(map);
      labelsTileLayerRef.current = labels;
    } else if (style === 'topo') {
      base = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
        { attribution: 'Tiles &copy; Esri World Topo', maxZoom: 18 }
      ).addTo(map);
    } else if (style === 'tactical3d') {
      base = L.tileLayer(
        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        {
          attribution: '&copy; OpenStreetMap · Tactical 3D',
          maxZoom: 18,
          keepBuffer: 2,
        }
      ).addTo(map);

      setIs3DExtruded(true);
      const districtTopKhoroo = activeDistrict
        ? UB_KHOROOS.filter((k) => k.districtId === activeDistrict.id).sort(
            (a, b) => b.riskScore - a.riskScore
          )[0]
        : null;
      const target =
        selectedKhoroo?.center ??
        districtTopKhoroo?.center ??
        activeDistrict?.center ??
        UB_CENTER_COORDS;
      if (map.getZoom() < 15) {
        focusMap(map, target, 15, 0.4);
      }
      window.setTimeout(() => map.invalidateSize({ animate: false }), 120);
    } else if (style === 'dark') {
      base = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        { attribution: 'Tiles &copy; Esri Dark Gray', maxZoom: 16 }
      ).addTo(map);

      const labels = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
        { maxZoom: 16, opacity: 0.9, pane: 'labelsPane' }
      ).addTo(map);
      labelsTileLayerRef.current = labels;
    } else {
      base = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);
    }

    if (style !== 'tactical3d') {
      if (tileStyle === 'tactical3d' && !selectedKhoroo) {
        const backCenter = activeDistrict ? activeDistrict.center : UB_CENTER_COORDS;
        const backZoom = activeDistrict ? 12 : 11;
        focusMap(map, backCenter, backZoom, 0.35);
      }
      window.setTimeout(() => map.invalidateSize({ animate: false }), 100);
    }

    base.setZIndex(1);
    baseTileLayerRef.current = base;
  };

  // 3. Sync external district selection (skip redundant flyTo on initial mount, preserve Z15 in Tactical 3D)
  useEffect(() => {
    if (prevSyncedDistrictIdRef.current === selectedDistrictId) return;
    prevSyncedDistrictIdRef.current = selectedDistrictId;
    if (selectedDistrictId) {
      const match = UB_DISTRICTS.find((d) => d.id === selectedDistrictId);
      if (match) {
        setActiveDistrict(match);
        setSelectedKhoroo(null);
        setIsPanelOpen(true);
        if (mapInstanceRef.current) {
          if (tileStyle === 'tactical3d') {
            const topKhoroo = UB_KHOROOS.filter((k) => k.districtId === match.id).sort(
              (a, b) => b.riskScore - a.riskScore
            )[0];
            focusMap(mapInstanceRef.current, topKhoroo?.center ?? match.center, 15, 0.42);
          } else {
            focusMap(mapInstanceRef.current, match.center, 12);
          }
        }
      }
    }
  }, [selectedDistrictId, tileStyle]);

  const handleHeatHoverSample = useCallback(
    (sample: HeatHoverSample | null) => {
      const el = hoverReadoutRef.current;
      if (!el) return;
      if (!sample || !showHeatmap) {
        el.textContent = '';
        el.style.display = 'none';
        return;
      }
      el.style.display = 'inline';
      el.textContent =
        sample.result.score !== null
          ? `${sample.result.nearestPoint?.label ? `${sample.result.nearestPoint.label} · ` : ''}${sample.result.score}/100`
          : isMn
          ? 'Харьцангуй сийрэг бүс'
          : 'Sparse coverage';
    },
    [showHeatmap, isMn]
  );

  const isDarkBasemap = tileStyle === 'satellite' || tileStyle === 'dark' || tileStyle === 'tactical3d';

  const polygonStateRef = useRef({
    liveDistricts,
    activeDistrictId: activeDistrict?.id ?? null,
    showHeatmap,
    isDarkBasemap,
    tileStyle,
    onSelectDistrict,
  });
  polygonStateRef.current = {
    liveDistricts,
    activeDistrictId: activeDistrict?.id ?? null,
    showHeatmap,
    isDarkBasemap,
    tileStyle,
    onSelectDistrict,
  };

  const getDistrictFillColor = (riskLevel: DistrictData['riskLevel']) => {
    if (riskLevel === 'very_high') return '#E93B2F';
    if (riskLevel === 'high') return '#FF633C';
    if (riskLevel === 'moderate') return '#F59E0B';
    return '#12B89A';
  };

  const buildDistrictPolygonStyle = useCallback(
    (
      d: DistrictData,
      isSelected: boolean,
      isHovered: boolean,
      styleTile: MapTileStyle,
      darkBase: boolean,
      heatVisible: boolean
    ): L.PathOptions => {
      const fillColor = getDistrictFillColor(d.riskLevel);
      const isTactical = styleTile === 'tactical3d';
      const selectedStroke = isTactical
        ? 'rgba(96, 165, 250, 0.72)'
        : darkBase
        ? 'rgba(255, 138, 101, 0.95)'
        : '#0B124D';
      const defaultHeatStroke = isTactical
        ? 'rgba(59, 130, 246, 0.28)'
        : darkBase
        ? 'rgba(148, 163, 184, 0.36)'
        : 'rgba(11,18,77,0.45)';

      if (heatVisible || isTactical) {
        return {
          color: isSelected || (isHovered && !isTactical) ? selectedStroke : defaultHeatStroke,
          weight: isHovered && !isTactical ? 2.4 : isSelected ? (isTactical ? 1.4 : 2.1) : 1.1,
          dashArray: '4 4',
          opacity: isSelected || isHovered ? 0.92 : 0.65,
          fillColor,
          fillOpacity: isHovered && !isTactical ? 0.14 : 0,
        };
      }

      // Default discrete choropleth mode: clear shaded fills + crisp hover feedback
      const baseFill = darkBase ? 0.26 : 0.18;
      return {
        color: isSelected || isHovered ? selectedStroke : fillColor,
        weight: isHovered ? 2.8 : isSelected ? 2.3 : 1.5,
        dashArray: undefined,
        opacity: isSelected || isHovered ? 0.96 : 0.75,
        fillColor,
        fillOpacity: isHovered ? (darkBase ? 0.42 : 0.36) : isSelected ? baseFill + 0.12 : baseFill,
      };
    },
    []
  );

  // 4a. Mount district polygons ONCE (never tear down layers on weather ticks or hover)
  useEffect(() => {
    const group = districtsLayerGroup.current;
    if (!group || !mapInstance) return;
    if (districtPolygonsRef.current.size > 0) return;

    UB_DISTRICTS.forEach((seedDist) => {
      const polygon = L.polygon(seedDist.polygon, {
        interactive: true,
        ...buildDistrictPolygonStyle(seedDist, false, false, tileStyle, isDarkBasemap, showHeatmap),
      });

      polygon.on('click', () => {
        const st = polygonStateRef.current;
        if (st.tileStyle === 'tactical3d') return;
        const latest = st.liveDistricts.find((item) => item.id === seedDist.id) ?? seedDist;
        setActiveDistrict(latest);
        setSelectedKhoroo(null);
        setIsPanelOpen(true);
        if (st.onSelectDistrict) st.onSelectDistrict(latest.id);
        if (mapInstanceRef.current) {
          focusMap(mapInstanceRef.current, latest.center, 12);
        }
      });

      polygon.on('mouseover', () => {
        const st = polygonStateRef.current;
        if (st.tileStyle === 'tactical3d') return;
        hoveredDistrictIdRef.current = seedDist.id;
        const latest = st.liveDistricts.find((item) => item.id === seedDist.id) ?? seedDist;
        polygon.setStyle(
          buildDistrictPolygonStyle(
            latest,
            st.activeDistrictId === seedDist.id,
            true,
            st.tileStyle,
            st.isDarkBasemap,
            st.showHeatmap
          )
        );
        polygon.bringToFront();
      });

      polygon.on('mouseout', () => {
        const st = polygonStateRef.current;
        if (hoveredDistrictIdRef.current === seedDist.id) {
          hoveredDistrictIdRef.current = null;
        }
        const latest = st.liveDistricts.find((item) => item.id === seedDist.id) ?? seedDist;
        polygon.setStyle(
          buildDistrictPolygonStyle(
            latest,
            st.activeDistrictId === seedDist.id,
            false,
            st.tileStyle,
            st.isDarkBasemap,
            st.showHeatmap
          )
        );
      });

      polygon.bindTooltip('', { sticky: true });
      districtPolygonsRef.current.set(seedDist.id, polygon);
      group.addLayer(polygon);
    });

    return () => {
      districtPolygonsRef.current.clear();
    };
  }, [mapInstance, buildDistrictPolygonStyle, setActiveDistrict, setSelectedKhoroo]);

  // 4b. Lightweight in-place style & tooltip sync (zero clearLayers flicker)
  useEffect(() => {
    const isTactical = tileStyle === 'tactical3d';
    liveDistricts.forEach((d) => {
      const polygon = districtPolygonsRef.current.get(d.id);
      if (!polygon) return;

      const isSelected = activeDistrict?.id === d.id;
      const isHovered = hoveredDistrictIdRef.current === d.id && !isTactical;
      const fillColor = getDistrictFillColor(d.riskLevel);
      polygon.setStyle(
        buildDistrictPolygonStyle(d, isSelected, isHovered, tileStyle, isDarkBasemap, showHeatmap)
      );

      const el = polygon.getElement() as HTMLElement | undefined;
      if (el) {
        el.style.pointerEvents = isTactical ? 'none' : 'auto';
        el.style.cursor = isTactical ? 'default' : 'pointer';
      }

      if (!isTactical) {
        const distW = live.districts[d.id];
        const axis = fireState.districtThreeAxis.get(d.id);
        const probLine =
          axis && axis.ignitionProbability.unlocked && axis.ignitionProbability.probabilityPct !== null
            ? `${isMn ? 'Магадлал' : 'Prob'}: <b>${axis.ignitionProbability.probabilityPct}%</b>`
            : `${isMn ? 'Магадлал' : 'Prob'}: <span>${isMn ? 'Түгжигдсэн' : 'Locked'}</span>`;
        const weatherLine = distW
          ? ` · FWI ${distW.fireWeatherIndex} (${distW.tempCelsius}°C, ${distW.windSpeedKmh} ${isMn ? 'км/ц' : 'km/h'})`
          : '';
        const confLine = escapeHtml(locationConfidenceLabel(d.locationConfidence, isMn));

        polygon.setTooltipContent(
          `<div style="font-family: inherit; padding: 6px; font-size: 12px; line-height: 1.45;">
            <div style="font-weight: 700; color: #0B124D; font-size: 13px;">${escapeHtml(
              isMn ? `${d.nameMn} дүүрэг` : `${d.nameEn} District`
            )}</div>
            <div style="font-size: 12px; color: #4B5563;">
              ${escapeHtml(t.riskIndicatorTitle)}: <b style="color:${fillColor}">${d.riskScore}/100</b> · ${probLine}
            </div>
            <div style="font-size: 12px; color: #0B124D; margin-top: 2px;">
              ${isMn ? `${d.khoroosCount} хороо${weatherLine}` : `${d.khoroosCount} khoroos${weatherLine}`}
            </div>
            <div style="font-size: 12px; color: #6B7280; margin-top: 2px;">
              ${confLine}
            </div>
          </div>`
        );
      } else {
        polygon.closeTooltip();
      }
    });
  }, [
    liveDistricts,
    live.districts,
    fireState.districtThreeAxis,
    activeDistrict,
    showHeatmap,
    isDarkBasemap,
    tileStyle,
    isMn,
    t.riskIndicatorTitle,
    buildDistrictPolygonStyle,
  ]);

  // 5. Deduplicated Thermal Surface Points (merged urban corridors + live-weather khoroos + k-anonymous verified clusters)
  const heatPoints = useMemo<HeatPoint[]>(() => {
    const corridors = UB_HEATMAP_HOTSPOTS.map(([lat, lng, radius, name, dangerScore]) => ({
      lat,
      lng,
      radiusMeters: radius,
      score: dangerScore,
      label: isMn ? name : hotspotNameEn(name),
      labelValue: `${dangerScore}/100`,
      isModelled: false,
    }));

    const fromKhoroos = liveKhoroos.map((k) => ({
      lat: k.center[0],
      lng: k.center[1],
      radiusMeters: 620 + Math.round(k.gerHouseholdPercent * 5.2),
      score: k.riskScore,
      label: isMn ? k.nameMn : k.nameEn,
      labelValue: `${k.riskScore}/100`,
      isModelled: k.isModelled,
    }));

    const verifiedClusters = fireState.publicClusters
      .filter((cl) => cl.kAnonymitySatisfied)
      .map((cl) => {
        const score = Math.min(96, Math.max(55, 58 + cl.incidentCount * 3 + cl.criticalCount * 5));
        return {
          lat: cl.lat,
          lng: cl.lng,
          radiusMeters: 900,
          score,
          label: isMn
            ? `${cl.khorooNumber}-р хороо (Баталгаажсан бүлэг: ${cl.incidentCount})`
            : `Khoroo ${cl.khorooNumber} (Verified cluster: ${cl.incidentCount})`,
          labelValue: `${score}/100`,
          isModelled: false,
        };
      });

    const merged = mergeSpatialHeatSources(corridors, [...fromKhoroos, ...verifiedClusters]);
    return merged.map((m) => ({
      lat: m.lat,
      lng: m.lng,
      radiusMeters: m.radiusMeters,
      score: m.score,
      label: m.label,
      labelValue: m.labelValue ?? `${m.score}/100`,
      isModelled: m.isModelled,
    }));
  }, [isMn, liveKhoroos, fireState.publicClusters]);

  const ubAverageRisk = fireState.cityAverageRisk;

  // 6. Render Khoroo Markers
  const visibleKhoroos = useMemo(() => {
    if (khorooMode === 'none') return [];
    if (khorooMode === 'all') return liveKhoroos;
    if (!activeDistrict) return [];
    return liveKhoroos.filter((k) => k.districtId === activeDistrict.id);
  }, [khorooMode, activeDistrict, liveKhoroos]);

  const isDetailedZoom = mapZoom >= 13;
  const isStreetZoom = mapZoom >= 14;

  useEffect(() => {
    const group = khoroosLayerGroup.current;
    if (!group) return;
    group.clearLayers();

    if (visibleKhoroos.length === 0 || tileStyle === 'tactical3d') return;

    // Low zoom (< 13): cluster khoroo badges per district to eliminate label collisions
    if (!isDetailedZoom) {
      const grouped = new Map<string, { dist: DistrictData; count: number; maxRisk: number }>();
      for (const kh of visibleKhoroos) {
        const dist = UB_DISTRICTS.find((d) => d.id === kh.districtId);
        if (!dist) continue;
        const cur = grouped.get(dist.id);
        if (cur) {
          cur.count += 1;
          cur.maxRisk = Math.max(cur.maxRisk, kh.riskScore);
        } else {
          grouped.set(dist.id, { dist, count: 1, maxRisk: kh.riskScore });
        }
      }

      grouped.forEach(({ dist, count, maxRisk }) => {
        const badgeBg =
          maxRisk >= 75 ? '#E93B2F' : maxRisk >= 55 ? '#FF633C' : maxRisk >= 35 ? '#F59E0B' : '#12B89A';
        const clusterIcon = L.divIcon({
          className: 'custom-khoroo-cluster-marker',
          html: `
            <div style="
              display: inline-flex;
              align-items: center;
              gap: 6px;
              background: rgba(11, 18, 77, 0.94);
              color: #FFFFFF;
              padding: 4px 10px;
              border-radius: 9999px;
              border: 1.5px solid ${badgeBg};
              box-shadow: 0 3px 10px rgba(0,0,0,0.28);
              cursor: pointer;
              white-space: nowrap;
              font-size: 12px;
              font-weight: 700;
            ">
              <span style="width: 7px; height: 7px; border-radius: 50%; background: ${badgeBg};"></span>
              <span>${escapeHtml(isMn ? dist.nameMn : dist.nameEn)}</span>
              <span style="font-family: monospace; font-size: 12px; opacity: 0.9;">${count} ${isMn ? 'хороо' : 'kh'}</span>
            </div>
          `,
          iconSize: [148, 28],
          iconAnchor: [74, 14],
        });

        const clusterMarker = L.marker(dist.center, { icon: clusterIcon });
        clusterMarker.on('click', () => {
          setActiveDistrict(dist);
          setSelectedKhoroo(null);
          setIsPanelOpen(true);
          if (mapInstanceRef.current) focusMap(mapInstanceRef.current, dist.center, 13);
        });
        group.addLayer(clusterMarker);
      });

      if (selectedKhoroo) {
        const selColor =
          selectedKhoroo.riskScore >= 75
            ? '#E93B2F'
            : selectedKhoroo.riskScore >= 55
            ? '#FF633C'
            : selectedKhoroo.riskScore >= 35
            ? '#F59E0B'
            : '#12B89A';
        const selIcon = L.divIcon({
          className: 'custom-khoroo-marker',
          html: `
            <div style="
              display: inline-flex; align-items: center; gap: 5px;
              background: #0B124D; color: #FFFFFF; padding: 3px 8px;
              border-radius: 9999px; border: 1.5px solid ${selColor};
              box-shadow: 0 3px 10px rgba(0,0,0,0.28); font-size: 12px; font-weight: 700; white-space: nowrap;
            ">
              <span>${escapeHtml(isMn ? `${selectedKhoroo.khorooNumber}-р` : `Kh.${selectedKhoroo.khorooNumber}`)}</span>
              <span style="font-family: monospace; font-size: 12px;">${selectedKhoroo.riskScore}</span>
            </div>
          `,
          iconSize: [78, 26],
          iconAnchor: [39, 13],
        });
        group.addLayer(L.marker(selectedKhoroo.center, { icon: selIcon }));
      }
      return;
    }

    visibleKhoroos.forEach((kh) => {
      const isSelected = selectedKhoroo?.id === kh.id;

      let badgeBg = '#12B89A';
      if (kh.riskScore >= 75) badgeBg = '#E93B2F';
      else if (kh.riskScore >= 55) badgeBg = '#FF633C';
      else if (kh.riskScore >= 35) badgeBg = '#F59E0B';

      const khorooIcon =
        isStreetZoom || isSelected
          ? L.divIcon({
              className: 'custom-khoroo-marker',
              html: `
                <div style="
                  display: inline-flex;
                  align-items: center;
                  gap: 5px;
                  background: ${isSelected ? '#0B124D' : 'rgba(255, 255, 255, 0.96)'};
                  color: ${isSelected ? '#FFFFFF' : '#0B124D'};
                  padding: 3px 8px;
                  border-radius: 9999px;
                  border: 1.5px solid ${badgeBg};
                  box-shadow: 0 3px 10px rgba(0,0,0,0.22);
                  cursor: pointer;
                  white-space: nowrap;
                  font-size: 12px;
                  font-weight: 700;
                  transform: ${isSelected ? 'scale(1.08)' : 'scale(1)'};
                  transition: transform 0.15s ease;
                ">
                  <span style="width: 6px; height: 6px; border-radius: 50%; background: ${badgeBg};"></span>
                  <span>${escapeHtml(isMn ? `${kh.khorooNumber}-р` : `Kh.${kh.khorooNumber}`)}</span>
                  <span style="font-family: monospace; font-size: 12px; padding: 0.5px 4px; border-radius: 4px; background: ${badgeBg}; color: white;">${kh.riskScore}</span>
                </div>
              `,
              iconSize: [82, 26],
              iconAnchor: [41, 13],
            })
          : L.divIcon({
              className: 'custom-khoroo-node-marker',
              html: `
                <div style="
                  width: 26px;
                  height: 26px;
                  border-radius: 50%;
                  background: rgba(255,255,255,0.96);
                  color: #0B124D;
                  border: 2px solid ${badgeBg};
                  box-shadow: 0 2px 6px rgba(11,18,77,0.28);
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  font-size: 12px;
                  font-weight: 800;
                  font-family: monospace;
                  cursor: pointer;
                " title="${escapeHtml(isMn ? kh.nameMn : kh.nameEn)} (${kh.riskScore}/100)" aria-label="${escapeHtml(
                `${isMn ? `${kh.khorooNumber}-р хороо` : `Khoroo ${kh.khorooNumber}`} (${kh.riskScore}/100)`
              )}">${kh.khorooNumber}</div>
              `,
              iconSize: [26, 26],
              iconAnchor: [13, 13],
            });

      const marker = L.marker(kh.center, { icon: khorooIcon });

      marker.on('click', () => {
        setSelectedKhoroo(kh);
        setIsPanelOpen(true);
        if (mapInstanceRef.current) {
          focusMap(mapInstanceRef.current, kh.center, 14);
        }
      });

      const khLevelText = riskLevelLabel(kh.riskLevel, isMn);
      const khConfText = escapeHtml(locationConfidenceLabel(kh.locationConfidence, isMn));
      marker.bindTooltip(
        `<div style="font-family: inherit; padding: 6px; font-size: 12px; line-height: 1.4;">
          <div style="font-weight: 700; color: #0B124D; font-size: 13px;">${escapeHtml(
            isMn ? kh.nameMn : kh.nameEn
          )}</div>
          <div style="font-size: 12px; color: ${badgeBg}; font-weight: 700;">
            ${isMn ? 'Эрсдэлийн индекс' : 'Risk index'}: ${kh.riskScore}/100 (${escapeHtml(khLevelText)})
          </div>
          <div style="font-size: 12px; color: #4B5563; margin-top: 2px;">
            ${isMn ? 'Гэр хороолол' : 'Ger households'}: ${kh.gerHouseholdPercent}% ·
            ${isMn ? 'Ирэх хугацаа' : 'Response'}: ~${kh.avgResponseTimeMin} ${isMn ? 'мин' : 'min'}
          </div>
          <div style="font-size: 12px; color: #6B7280; margin-top: 2px;">
            ${khConfText}
          </div>
        </div>`,
        { sticky: true }
      );

      group.addLayer(marker);
    });
  }, [visibleKhoroos, selectedKhoroo, tileStyle, isMn, isDetailedZoom, isStreetZoom]);

  // 7. Render Fire Stations & Access Buffers
  useEffect(() => {
    const group = stationsLayerGroup.current;
    const bufGroup = stationBuffersLayerGroup.current;
    if (!group || !bufGroup) return;

    group.clearLayers();
    bufGroup.clearLayers();
    if (!showStations || tileStyle === 'tactical3d') return;

    UB_FIRE_STATIONS.forEach((sta) => {
      if (showStationBuffers) {
        const buffer3km = L.circle(sta.coordinates, {
          radius: 3000,
          color: '#12B89A',
          weight: 1.5,
          dashArray: '4, 6',
          fillColor: '#12B89A',
          fillOpacity: 0.04,
          interactive: false,
        });

        const buffer5km = L.circle(sta.coordinates, {
          radius: 5000,
          color: '#0B124D',
          weight: 1,
          dashArray: '2, 8',
          fillColor: '#0B124D',
          fillOpacity: 0.02,
          interactive: false,
        });

        bufGroup.addLayer(buffer3km);
        bufGroup.addLayer(buffer5km);
      }

      const pinPx = isDetailedZoom ? 28 : 23;
      const stationIcon = L.divIcon({
        className: 'custom-station-marker',
        html: `
          <div style="
            width: ${pinPx}px;
            height: ${pinPx}px;
            border-radius: 50%;
            background: #0B124D;
            color: #FFFFFF;
            border: 1.5px solid #FFFFFF;
            outline: 1.5px solid #FF633C;
            box-shadow: 0 3px 8px rgba(11, 18, 77, 0.42);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: ${isDetailedZoom ? 14 : 12}px;
            cursor: pointer;
          ">🚒</div>
        `,
        iconSize: [pinPx, pinPx],
        iconAnchor: [pinPx / 2, pinPx / 2],
      });

      const marker = L.marker(sta.coordinates, { icon: stationIcon });
      marker.bindTooltip(
        `<div style="font-family: inherit; padding: 6px; font-size: 12px; line-height: 1.4;">
          <div style="font-weight: 700; color: #0B124D; font-size: 12px;">🚒 ${escapeHtml(
            isMn ? sta.nameMn : sta.nameEn
          )} (${escapeHtml(stationCodeLabel(sta.code, isMn))})</div>
          <div style="font-size: 12px; color: #4B5563;">
            ${isMn
              ? `ОБЕГ харьяа анги · Хүрэх тойрог: ~${sta.coverageRadiusKm} км`
              : `NEMA unit · Coverage radius: ~${sta.coverageRadiusKm} km`}
          </div>
          <div style="font-size: 12px; color: #6B7280;">
            ${escapeHtml(locationConfidenceLabel(sta.locationConfidence, isMn))}
          </div>
        </div>`,
        { sticky: true }
      );

      group.addLayer(marker);
    });
  }, [showStations, showStationBuffers, isMn, isDetailedZoom, tileStyle]);

  // 8. Render Incidents
  useEffect(() => {
    const group = incidentsLayerGroup.current;
    if (!group) return;
    group.clearLayers();
    if (!showIncidents) return;

    DEMO_HISTORICAL_INCIDENTS.forEach((inc) => {
      const circle = L.circleMarker(inc.coordinates, {
        radius: 5,
        fillColor: inc.severity === 'critical' ? '#E93B2F' : '#FF633C',
        color: '#FFFFFF',
        weight: 1.5,
        opacity: 0.95,
        fillOpacity: 0.85,
      });

      circle.bindTooltip(
        `<div style="font-family: inherit; font-size: 12px; padding: 4px;">
          <b>${escapeHtml(inc.date)}</b>: ${escapeHtml(isMn ? inc.causeGuessMn : inc.causeGuessEn)}
        </div>`
      );

      group.addLayer(circle);
    });
  }, [showIncidents, isMn]);

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    const q = query.toLowerCase().trim();
    const results: { type: 'district' | 'khoroo'; item: DistrictData | KhorooData }[] = [];

    UB_DISTRICTS.forEach((d) => {
      if (d.nameMn.toLowerCase().includes(q) || d.nameEn.toLowerCase().includes(q)) {
        results.push({ type: 'district', item: d });
      }
    });

    UB_KHOROOS.forEach((kh) => {
      if (
        kh.nameMn.toLowerCase().includes(q) ||
        kh.nameEn.toLowerCase().includes(q) ||
        `${kh.khorooNumber}` === q ||
        kh.landmarksMn.some((lm) => lm.toLowerCase().includes(q))
      ) {
        results.push({ type: 'khoroo', item: kh });
      }
    });

    setSearchResults(results.slice(0, 8));
  };

  const selectSearchResult = (res: { type: 'district' | 'khoroo'; item: DistrictData | KhorooData }) => {
    setSearchResults([]);
    setSearchQuery('');

    if (res.type === 'district') {
      const d = res.item as DistrictData;
      setActiveDistrict(d);
      setSelectedKhoroo(null);
      setIsPanelOpen(true);
      if (onSelectDistrict) onSelectDistrict(d.id);
      if (mapInstanceRef.current) focusMap(mapInstanceRef.current, d.center, 12);
    } else {
      const kh = res.item as KhorooData;
      const parentDist = UB_DISTRICTS.find((d) => d.id === kh.districtId);
      if (parentDist) {
        setActiveDistrict(parentDist);
        if (onSelectDistrict) onSelectDistrict(parentDist.id);
      }
      setSelectedKhoroo(kh);
      setIsPanelOpen(true);
      if (mapInstanceRef.current) {
        focusMap(mapInstanceRef.current, kh.center, tileStyle === 'tactical3d' ? 15 : 14);
      }
    }
  };

  const displayedDistricts = useMemo(() => {
    const list = [...liveDistricts];
    if (sortBy === 'risk_desc') return list.sort((a, b) => b.riskScore - a.riskScore);
    if (sortBy === 'alpha') return list.sort((a, b) => a.nameMn.localeCompare(b.nameMn));
    return list;
  }, [sortBy, liveDistricts]);

  const topFiveHighRiskZones = useMemo(
    () =>
      [...liveKhoroos]
        .sort((a, b) => b.riskScore - a.riskScore)
        .slice(0, 5)
        .map((kh) => ({
          khoroo: kh,
          district: liveDistricts.find((d) => d.id === kh.districtId) ?? UB_DISTRICTS[0],
        })),
    [liveKhoroos, liveDistricts]
  );

  const activeDistrictKhoroos = useMemo(() => {
    if (!activeDistrict) return [];
    return liveKhoroos
      .filter((k) => k.districtId === activeDistrict.id)
      .sort((a, b) => b.riskScore - a.riskScore);
  }, [activeDistrict, liveKhoroos]);

  const tacticalBaseFootprints = useMemo(
    () => generateCityBlueFootprints(liveKhoroos),
    [liveKhoroos]
  );

  const tacticalScene = useMemo(() => {
    if (tileStyle !== 'tactical3d' || liveKhoroos.length === 0) return null;
    return buildTactical3DScene({
      activeDistrict,
      selectedKhoroo,
      khoroos: liveKhoroos,
      stations: UB_FIRE_STATIONS,
      baseFootprints: tacticalBaseFootprints,
      assumptions,
    });
  }, [tileStyle, activeDistrict, selectedKhoroo, liveKhoroos, tacticalBaseFootprints, assumptions]);

  const handleFocusTacticalZone = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map || !tacticalScene) return;
    focusMap(map, tacticalScene.targetCoord, 15, 0.42);
  }, [tacticalScene]);

  const handleFitTacticalRoute = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map || !tacticalScene) return;
    const bounds = L.latLngBounds([
      tacticalScene.targetCoord,
      tacticalScene.nearestStation.coordinates,
    ]);
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 1024;
    map.fitBounds(bounds, {
      paddingTopLeft: [isMobile ? 36 : 84, isMobile ? 164 : 176],
      paddingBottomRight: [isMobile || !isPanelOpen ? 48 : 440, isMobile && isPanelOpen ? 270 : 140],
      maxZoom: 15,
      animate: true,
    });
  }, [tacticalScene, isPanelOpen]);

  const handleAnalyzeCurrentArea = () => {
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError(isMn ? 'Хөтөч байршил дэмжихгүй байна.' : 'Geolocation unsupported.');
      return;
    }
    setGeoLocating(true);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoLocating(false);
        const { latitude: userLat, longitude: userLng } = pos.coords;

        if (mapInstanceRef.current && userLocationLayerGroup.current) {
          userLocationLayerGroup.current.clearLayers();
          L.circleMarker([userLat, userLng], {
            radius: 8,
            fillColor: '#0B124D',
            color: '#FFFFFF',
            weight: 3,
            fillOpacity: 1,
          }).addTo(userLocationLayerGroup.current);

          let closest = UB_DISTRICTS[0];
          let minDist = Infinity;
          UB_DISTRICTS.forEach((d) => {
            const dist = Math.hypot(d.center[0] - userLat, d.center[1] - userLng);
            if (dist < minDist) {
              minDist = dist;
              closest = d;
            }
          });

          setActiveDistrict(closest);
          setSelectedKhoroo(null);
          setIsPanelOpen(true);
          if (onSelectDistrict) onSelectDistrict(closest.id);
          focusMap(mapInstanceRef.current, [userLat, userLng], 13, 1.0);
        }
      },
      () => {
        setGeoLocating(false);
        setGeoError(isMn ? 'Байршлын зөвшөөрөл олгогдоогүй.' : 'Location permission denied.');
        window.setTimeout(() => setGeoError(null), 3500);
      },
      { timeout: 8000 }
    );
  };

  const handleResetToAllUB = () => {
    setActiveDistrict(null);
    setSelectedKhoroo(null);
    setIsPanelOpen(false);
    if (mapInstanceRef.current) {
      focusMap(mapInstanceRef.current, UB_CENTER_COORDS, 11);
    }
  };

  const weatherBadgeText =
    live.status === 'live'
      ? 'LIVE'
      : live.status === 'stale'
      ? isMn
        ? 'ХУУЧИРСАН'
        : 'STALE'
      : live.status === 'loading'
      ? isMn
        ? 'АЧААЛЖ'
        : 'SYNC'
      : isMn
      ? 'ЗАГВАР'
      : 'OFFLINE';

  const activeMapOption = BASEMAP_OPTIONS.find((b) => b.id === (tileStyle === 'satellite' ? lastMapStyle : tileStyle)) || BASEMAP_OPTIONS[0];

  return (
    <div
      className={`relative w-full h-[calc(100dvh-54px-64px)] lg:h-[calc(100vh-65px)] overflow-hidden select-none ${
        isDarkBasemap ? 'bg-[#0B124D]' : 'bg-[#e5e9f0]'
      }`}
    >
      {/*
        TOP FLOATING CONTROLS
        Insects cleanly on desktop (`lg:right-[416px]`) whenever AreaAnalysisPanel is open,
        preventing any control overlap with the right detail drawer.
      */}
      <div
        className={`absolute top-3 left-3 right-3 sm:top-4 sm:left-4 z-[900] flex flex-col items-start gap-2 pointer-events-none transition-all duration-300 ${
          isPanelOpen ? 'lg:right-[424px]' : 'lg:right-4'
        }`}
      >
        {/* Single Unified Compact Floating Header Bar */}
        <div className="relative z-30 flex items-center justify-between gap-2 w-full pointer-events-auto">
          <div className="flex items-center flex-wrap sm:flex-nowrap gap-1 bg-white/95 rounded-2xl border border-black/[0.08] shadow-md p-1 flex-1 xl:flex-none min-w-0">
            {/* Search Input */}
            <div className={`relative flex-1 min-w-[92px] sm:flex-none ${isPanelOpen ? 'sm:w-36 md:w-44' : 'sm:w-44 md:w-52'}`}>
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#72778A] pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder={isMn ? 'Дүүрэг, хороо...' : 'Search...'}
                aria-label={isMn ? 'Дүүрэг эсвэл хороо хайх' : 'Search district or khoroo'}
                className="w-full min-h-[44px] pl-8 pr-11 bg-slate-100 hover:bg-slate-200/70 focus:bg-white rounded-xl text-xs text-[#0B124D] placeholder-[#72778A] focus:outline-none focus:ring-2 focus:ring-[#FF633C]/70 transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setSearchResults([]);
                  }}
                  aria-label={isMn ? 'Хайлт цэвэрлэх' : 'Clear search'}
                  className="absolute right-0.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-800 w-10 h-10 flex items-center justify-center rounded-lg"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}

              {searchResults.length > 0 && (
                <div className="absolute top-full left-0 w-72 sm:w-80 mt-2 bg-white rounded-2xl shadow-2xl border border-black/[0.08] overflow-hidden z-[970] p-1.5 divide-y divide-black/[0.04] max-h-64 overflow-y-auto">
                  {searchResults.map((res) => {
                    const isDist = res.type === 'district';
                    const d = res.item as DistrictData;
                    const kh = res.item as KhorooData;

                    return (
                      <button
                        key={isDist ? d.id : kh.id}
                        onClick={() => selectSearchResult(res)}
                        className="w-full text-left min-h-[44px] px-2.5 py-2 hover:bg-[#F7F8FA] rounded-xl flex items-center justify-between text-xs transition-colors"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span className="text-xs">{isDist ? '🏙️' : '📍'}</span>
                          <span className="font-bold text-[#0B124D] truncate">
                            {isDist ? (isMn ? d.nameMn : d.nameEn) : isMn ? kh.nameMn : kh.nameEn}
                          </span>
                        </div>
                        <span className="font-mono text-xs font-bold text-[#FF633C] shrink-0 ml-1">
                          {isDist ? d.riskScore : kh.riskScore}/100
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="h-5 w-px bg-slate-200/90 shrink-0 hidden sm:block" />

            {/* Consolidated Districts & Top-5 High-Risk Zones Filter Popover */}
            <div className="relative shrink-0" ref={districtFilterRef}>
              <button
                type="button"
                onClick={() => {
                  setShowBasemapDropdown(false);
                  setShowLayersDropdown(false);
                  setShowDistrictFilter((v) => !v);
                }}
                aria-expanded={showDistrictFilter}
                className={`min-h-[44px] px-2.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  showDistrictFilter
                    ? 'bg-[#0B124D] text-white shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200/70 text-[#0B124D]'
                }`}
                title={isMn ? 'Дүүрэг, хороо ба Эхний 5 өндөр эрсдэлтэй бүс' : 'Districts, Khoroos & Top-5 High-Risk Zones'}
              >
                <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate max-w-[120px] sm:max-w-[150px]">
                  {activeDistrict
                    ? `${isMn ? activeDistrict.nameMn : activeDistrict.nameEn} · ${activeDistrict.riskScore}`
                    : isMn
                    ? 'Бүх УБ · Эхний 5'
                    : 'All UB · Top 5'}
                </span>
                <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${showDistrictFilter ? 'rotate-180' : ''}`} />
              </button>

              {showDistrictFilter && (
                <div className="absolute top-full left-0 mt-2.5 w-[min(92vw,420px)] max-h-[75vh] overflow-y-auto bg-white/98 backdrop-blur-2xl rounded-2xl shadow-2xl border border-black/[0.1] p-3 z-[965] text-xs space-y-3 animate-pop-in">
                  {/* Quick Header & All UB Reset + Sort */}
                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100">
                    <button
                      type="button"
                      onClick={() => {
                        handleResetToAllUB();
                        setShowDistrictFilter(false);
                      }}
                      className={`min-h-[38px] px-3 rounded-xl font-bold flex items-center gap-1.5 transition-colors ${
                        !activeDistrict
                          ? 'bg-[#0B124D] text-white'
                          : 'bg-slate-100 hover:bg-slate-200 text-[#0B124D]'
                      }`}
                    >
                      <Globe className="w-3.5 h-3.5" />
                      <span>{isMn ? 'Бүх Улаанбаатар' : 'All Ulaanbaatar'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setSortBy(sortBy === 'risk_desc' ? 'default' : 'risk_desc')}
                      className={`min-h-[38px] px-2.5 rounded-xl font-mono font-bold flex items-center gap-1 transition-colors ${
                        sortBy === 'risk_desc'
                          ? 'bg-amber-500/15 text-amber-800 border border-amber-500/30'
                          : 'bg-slate-100 text-[#4B5563] hover:text-[#0B124D]'
                      }`}
                    >
                      <ArrowUpDown className="w-3.5 h-3.5" />
                      <span>{sortBy === 'risk_desc' ? (isMn ? 'Эрсдэлээр' : 'Top Risk') : isMn ? 'Бүсээр' : 'Default'}</span>
                    </button>
                  </div>

                  {/* Top-5 High-Risk Zones Quick Jump */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-xs font-mono font-bold uppercase text-[#E93B2F]">
                        {isMn ? 'Өндөр эрсдэлтэй эхний 5 бүс' : 'Top-5 High-Risk Zones'}
                      </span>
                      <span className="text-xs font-mono text-[#72778A]">0–100</span>
                    </div>
                    <div className="space-y-1">
                      {topFiveHighRiskZones.map(({ khoroo, district }, idx) => (
                        <button
                          key={khoroo.id}
                          type="button"
                          onClick={() => {
                            setActiveDistrict(district);
                            setSelectedKhoroo(khoroo);
                            setIsPanelOpen(true);
                            setShowDistrictFilter(false);
                            if (onSelectDistrict && district.id !== selectedDistrictId) {
                              onSelectDistrict(district.id);
                            }
                            if (mapInstanceRef.current) {
                              focusMap(mapInstanceRef.current, khoroo.center, tileStyle === 'tactical3d' ? 15 : 14);
                            }
                          }}
                          className="w-full min-h-[40px] px-2.5 py-1.5 rounded-xl bg-red-50/60 hover:bg-red-100/70 border border-red-200/60 flex items-center justify-between gap-2 text-left transition-colors"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-5 h-5 rounded-full bg-[#E93B2F] text-white font-mono text-xs font-bold flex items-center justify-center shrink-0">
                              {idx + 1}
                            </span>
                            <div className="min-w-0">
                              <div className="font-bold text-[#0B124D] truncate">
                                {isMn ? district.nameMn : district.nameEn} · {khorooLabel(khoroo.khorooNumber, isMn)}
                              </div>
                            </div>
                          </div>
                          <span className="font-mono font-bold text-[#E93B2F] shrink-0">
                            {khoroo.riskScore}/100
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 9 Districts Selector */}
                  <div className="space-y-1.5 pt-1 border-t border-slate-100">
                    <span className="text-xs font-mono font-bold uppercase text-[#72778A] px-1 block">
                      {isMn ? '9 Дүүрэг' : '9 Districts'}
                    </span>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                      {displayedDistricts.map((d) => {
                        const isSel = activeDistrict?.id === d.id && !selectedKhoroo;
                        const isVeryHigh = d.riskScore >= 75;
                        const isHigh = d.riskScore >= 55 && d.riskScore < 75;
                        return (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => {
                              setActiveDistrict(d);
                              setSelectedKhoroo(null);
                              setIsPanelOpen(true);
                              setShowDistrictFilter(false);
                              if (onSelectDistrict && d.id !== selectedDistrictId) {
                                onSelectDistrict(d.id);
                              } else if (mapInstanceRef.current) {
                                if (tileStyle === 'tactical3d') {
                                  const topKhoroo = UB_KHOROOS.filter((k) => k.districtId === d.id).sort(
                                    (a, b) => b.riskScore - a.riskScore
                                  )[0];
                                  focusMap(mapInstanceRef.current, topKhoroo?.center ?? d.center, 15);
                                } else {
                                  focusMap(mapInstanceRef.current, d.center, 12);
                                }
                              }
                            }}
                            className={`min-h-[40px] px-2.5 py-1.5 rounded-xl flex items-center justify-between gap-1.5 text-xs font-semibold transition-all border ${
                              isSel
                                ? 'bg-[#0B124D] text-white border-[#0B124D] font-bold shadow-xs'
                                : 'bg-[#F7F8FA] hover:bg-slate-100 text-[#0B124D] border-slate-200'
                            }`}
                          >
                            <span className="truncate">{isMn ? d.nameMn : d.nameEn}</span>
                            <span
                              className={`font-mono text-xs font-bold px-1.5 py-0.5 rounded leading-none shrink-0 ${
                                isSel
                                  ? 'bg-white/20 text-white'
                                  : isVeryHigh
                                  ? 'bg-red-100 text-[#E93B2F]'
                                  : isHigh
                                  ? 'bg-orange-100 text-[#FF633C]'
                                  : 'bg-emerald-100 text-emerald-800'
                              }`}
                            >
                              {d.riskScore}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Selected District Top Khoroos */}
                  {activeDistrict && activeDistrictKhoroos.length > 0 && (
                    <div className="space-y-1.5 pt-1 border-t border-slate-100">
                      <div className="flex items-center justify-between px-1">
                        <span className="text-xs font-mono font-bold uppercase text-[#72778A] flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-[#FF633C]" />
                          {isMn
                            ? `${activeDistrict.nameMn} (${activeDistrict.khoroosCount} хороо)`
                            : `${activeDistrict.nameEn} (${activeDistrict.khoroosCount} khoroos)`}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setIsPanelOpen(true);
                            setShowDistrictFilter(false);
                          }}
                          className="text-xs font-mono font-semibold text-[#0B124D] hover:text-[#FF633C] underline"
                        >
                          {isMn ? 'Бүгдийг харах →' : 'View all →'}
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {activeDistrictKhoroos.slice(0, 8).map((kh) => {
                          const isSelKh = selectedKhoroo?.id === kh.id;
                          return (
                            <button
                              key={kh.id}
                              type="button"
                              onClick={() => {
                                setSelectedKhoroo(kh);
                                setIsPanelOpen(true);
                                setShowDistrictFilter(false);
                                if (mapInstanceRef.current) {
                                  focusMap(mapInstanceRef.current, kh.center, tileStyle === 'tactical3d' ? 15 : 14);
                                }
                              }}
                              className={`min-h-[36px] px-2.5 py-1 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors border ${
                                isSelKh
                                  ? 'bg-[#FF633C] text-white border-[#FF633C] font-bold'
                                  : 'bg-[#F7F8FA] hover:bg-slate-100 text-[#0B124D] border-slate-200'
                              }`}
                            >
                              <span>{khorooLabel(kh.khorooNumber, isMn)}</span>
                              <span className={`font-mono font-bold ${isSelKh ? 'text-white' : 'text-[#72778A]'}`}>
                                {kh.riskScore}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="h-5 w-px bg-slate-200/90 shrink-0 hidden sm:block" />

            {/* Satellite / Selectable Basemap Switcher */}
            <div className="relative shrink-0" ref={basemapDropdownRef}>
              <div className="flex items-center bg-slate-100 p-0.5 rounded-xl text-xs">
                <button
                  onClick={() => handleTileChange('satellite')}
                  className={`min-h-[44px] px-2.5 rounded-lg font-semibold transition-all flex items-center gap-1.5 ${
                    tileStyle === 'satellite'
                      ? 'bg-[#FF633C] text-white shadow-xs'
                      : 'text-[#72778A] hover:text-[#0B124D]'
                  }`}
                  title={isMn ? 'Хиймэл дагуулын бодит зураг' : 'Real satellite imagery'}
                >
                  <Satellite className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-xs hidden sm:inline">{isMn ? 'Бодит' : 'Satellite'}</span>
                </button>
                <button
                  onClick={() => {
                    setShowLayersDropdown(false);
                    setShowDistrictFilter(false);
                    if (tileStyle === 'satellite') {
                      handleTileChange(lastMapStyle);
                    } else {
                      setShowBasemapDropdown((v) => !v);
                    }
                  }}
                  className={`min-h-[44px] px-2.5 rounded-lg font-semibold transition-all flex items-center gap-1 ${
                    tileStyle !== 'satellite'
                      ? 'bg-[#0B124D] text-white shadow-xs'
                      : 'text-[#72778A] hover:text-[#0B124D]'
                  }`}
                  title={isMn ? 'Энгийн зураг ба дэвсгэр сонгох' : 'Normal map & basemap styles'}
                >
                  <MapIcon className="w-3.5 h-3.5 shrink-0 hidden sm:inline" />
                  <span className="text-xs">
                    {tileStyle !== 'satellite'
                      ? isMn
                        ? activeMapOption.shortMn
                        : activeMapOption.shortEn
                      : isMn
                      ? 'Зураг'
                      : 'Map'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowLayersDropdown(false);
                    setShowDistrictFilter(false);
                    setShowBasemapDropdown((v) => !v);
                  }}
                  aria-label={isMn ? 'Газрын зургийн төрөл сонгох' : 'Choose map basemap style'}
                  aria-expanded={showBasemapDropdown}
                  className={`min-h-[44px] min-w-[44px] px-2 rounded-lg transition-colors flex items-center justify-center ${
                    showBasemapDropdown
                      ? 'bg-white text-[#0B124D] shadow-xs'
                      : 'text-[#72778A] hover:text-[#0B124D]'
                  }`}
                  title={isMn ? 'Зургийн төрөл сонгох' : 'Select basemap style'}
                >
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showBasemapDropdown ? 'rotate-180' : ''}`} />
                </button>
              </div>

              {showBasemapDropdown && (
                <div className="absolute top-full right-0 sm:left-0 mt-2.5 bg-white/98 backdrop-blur-2xl rounded-2xl shadow-2xl border border-black/[0.1] p-2 w-72 z-[960] text-xs space-y-1 animate-pop-in">
                  <div className="text-xs font-mono uppercase text-[#72778A] font-bold px-2 py-0.5 flex items-center justify-between">
                    <span>{isMn ? 'Газрын зургийн хэлбэр' : 'Map basemap style'}</span>
                    <span className="text-xs text-[#FF633C] font-bold">{1 + BASEMAP_OPTIONS.length}</span>
                  </div>
                  <button
                    onClick={() => handleTileChange('satellite')}
                    className={`w-full text-left min-h-[44px] px-2.5 py-2 rounded-xl flex items-center gap-2.5 transition-colors ${
                      tileStyle === 'satellite'
                        ? 'bg-[#FF633C]/12 text-[#0B124D] ring-1 ring-[#FF633C]/40 font-bold'
                        : 'hover:bg-slate-100 text-[#0B124D]'
                    }`}
                  >
                    <span
                      className="w-7 h-7 rounded-lg border border-black/15 shrink-0 flex items-center justify-center text-xs shadow-inner"
                      style={{ background: 'linear-gradient(135deg, #3f4f3c 0%, #5c5346 55%, #1e293b 100%)' }}
                    >
                      🛰️
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-bold truncate">{isMn ? 'Бодит (Хиймэл дагуул)' : 'Satellite Imagery'}</div>
                      <div className="text-xs text-[#72778A] truncate">
                        {isMn ? 'Өндөр нарийвчлалтай сансрын зураг' : 'Esri World Imagery + Labels'}
                      </div>
                    </div>
                    {tileStyle === 'satellite' && <span className="text-[#FF633C] font-bold text-xs">✓</span>}
                  </button>

                  <div className="border-t border-slate-100 my-1" />

                  {BASEMAP_OPTIONS.map((opt) => {
                    const active = tileStyle === opt.id;
                    return (
                      <button
                        key={opt.id}
                        onClick={() => handleTileChange(opt.id)}
                        className={`w-full text-left min-h-[44px] px-2.5 py-1.5 rounded-xl flex items-center gap-2.5 transition-colors ${
                          active
                            ? 'bg-[#0B124D] text-white font-bold shadow-sm'
                            : 'hover:bg-slate-100 text-[#0B124D]'
                        }`}
                      >
                        <span
                          className="w-7 h-7 rounded-lg border border-black/15 shrink-0 flex items-center justify-center text-xs shadow-inner"
                          style={{ background: opt.swatch }}
                        >
                          {opt.icon}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate leading-tight">{isMn ? opt.labelMn : opt.labelEn}</div>
                          <div
                            className={`text-xs truncate ${
                              active ? 'text-white/80' : 'text-[#72778A]'
                            }`}
                          >
                            {isMn ? opt.descMn : opt.descEn}
                          </div>
                        </div>
                        {active && <span className="text-xs font-bold">✓</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="h-5 w-px bg-slate-200/90 shrink-0 hidden sm:block" />

            {/* Thermal Heatmap Toggle */}
            <button
              onClick={() => {
                if (tileStyle === 'tactical3d') {
                  showOverlayNotice(
                    '3D Тактик горимд дулааны давхарга түр унтарч, барилга ба радиус тод харагдана.',
                    'Heatmap pauses automatically in 3D Tactical so buildings and zone rings stay legible.'
                  );
                  return;
                }
                setOverlayState('heatmap', !showHeatmap);
              }}
              className={`min-h-[44px] px-2.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shrink-0 ${
                tileStyle === 'tactical3d'
                  ? 'bg-slate-100 text-[#72778A] hover:bg-slate-200/80'
                  : showHeatmap
                  ? 'bg-[#E93B2F] text-white shadow-xs'
                  : 'text-[#0B124D] hover:bg-slate-100'
              }`}
              title={
                tileStyle === 'tactical3d'
                  ? isMn
                    ? '3D Тактик горимд дулааны бүс түр унтардаг'
                    : 'Paused in 3D Tactical mode'
                  : isMn
                  ? 'Эрсдэлийн дулааны бүсийг харуулах/нуух'
                  : 'Show or hide the thermal risk surface'
              }
              aria-label={isMn ? 'Дулааны бүс' : 'Heatmap'}
            >
              <Flame className="w-3.5 h-3.5 shrink-0" />
              <span className="text-xs hidden md:inline">
                {isMn ? 'Дулааны бүс' : 'Heatmap'}
              </span>
            </button>

            {/* Layers Dropdown Menu */}
            <div className="relative shrink-0" ref={layersDropdownRef}>
              <button
                onClick={() => {
                  setShowBasemapDropdown(false);
                  setShowDistrictFilter(false);
                  setShowLayersDropdown(!showLayersDropdown);
                }}
                className={`min-h-[44px] px-2.5 rounded-xl text-xs font-semibold flex items-center gap-1 transition-all ${
                  showLayersDropdown ? 'bg-[#0B124D] text-white' : 'text-[#0B124D] hover:bg-slate-100'
                }`}
                title={isMn ? 'Давхарга & шүүлтүүр' : 'Layers & filters'}
                aria-label={isMn ? 'Давхаргууд' : 'Layers'}
              >
                <Layers className="w-3.5 h-3.5 shrink-0" />
                <span className="text-xs hidden lg:inline">
                  {isMn ? 'Давхаргууд' : 'Layers'} ({overlayOrder.length}/2)
                </span>
                <ChevronDown className={`w-3.5 h-3.5 opacity-70 transition-transform ${showLayersDropdown ? 'rotate-180' : ''}`} />
              </button>

              {showLayersDropdown && (
                <div className="absolute top-full right-0 mt-2.5 bg-white/98 backdrop-blur-2xl rounded-2xl shadow-2xl border border-black/[0.1] p-2.5 w-72 z-[950] text-xs space-y-1.5 animate-pop-in">
                  <div className="flex items-center justify-between px-2 py-0.5">
                    <span className="text-xs font-mono uppercase text-[#72778A] font-bold">
                      {isMn ? 'Хороодын харагдац:' : 'Khoroo visibility:'}
                    </span>
                    <span className="text-xs font-mono font-bold text-[#FF633C]">
                      {overlayOrder.length}/2 {isMn ? 'идэвхтэй' : 'active'}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setOverlayState('khoroos', true, 'district_only');
                      setShowLayersDropdown(false);
                    }}
                    className={`w-full text-left min-h-[40px] px-3 py-1.5 rounded-xl transition-colors ${
                      khorooMode === 'district_only' ? 'bg-[#0B124D] text-white font-bold' : 'hover:bg-slate-100 text-[#0B124D]'
                    }`}
                  >
                    {isMn ? 'Сонгосон дүүргийн хороод' : 'Selected district only'}
                  </button>
                  <button
                    onClick={() => {
                      setOverlayState('khoroos', true, 'all');
                      setShowLayersDropdown(false);
                    }}
                    className={`w-full text-left min-h-[40px] px-3 py-1.5 rounded-xl transition-colors ${
                      khorooMode === 'all' ? 'bg-[#0B124D] text-white font-bold' : 'hover:bg-slate-100 text-[#0B124D]'
                    }`}
                  >
                    {isMn
                      ? `Бүх ${UB_KHOROOS.length} хороо (нийслэл)`
                      : `All ${UB_KHOROOS.length} khoroos (capital)`}
                  </button>
                  <button
                    onClick={() => {
                      setOverlayState('khoroos', false);
                      setShowLayersDropdown(false);
                    }}
                    className={`w-full text-left min-h-[40px] px-3 py-1.5 rounded-xl transition-colors ${
                      khorooMode === 'none' ? 'bg-[#0B124D] text-white font-bold' : 'hover:bg-slate-100 text-[#0B124D]'
                    }`}
                  >
                    {isMn ? 'Хороодын тэмдэглэгээ нуух' : 'Hide khoroo markers'}
                  </button>

                  <div className="border-t border-slate-100 my-1" />

                  <div className="text-xs font-mono uppercase text-[#72778A] font-bold px-2 py-0.5">
                    {isMn ? 'Нэмэлт давхаргууд (дээд нь 2):' : 'Optional layers (max 2):'}
                  </div>
                  <button
                    onClick={() => setOverlayState('stations', !showStations)}
                    className="w-full text-left min-h-[40px] px-3 py-1.5 rounded-xl hover:bg-slate-100 text-[#0B124D] flex items-center justify-between"
                  >
                    <span>🚒 {isMn ? 'Гал унтраах ангиуд' : 'Fire stations'}</span>
                    <span className="font-bold text-xs">{showStations ? (isMn ? 'Идэвхтэй' : 'On') : isMn ? 'Хаалттай' : 'Off'}</span>
                  </button>
                  <button
                    onClick={() => setOverlayState('buffers', !showStationBuffers)}
                    className="w-full text-left min-h-[40px] px-3 py-1.5 rounded-xl hover:bg-slate-100 text-[#0B124D] flex items-center justify-between"
                  >
                    <span>⭕ {isMn ? 'Хүрэх тойрог (3 / 5 км)' : 'Coverage (3 / 5 km)'}</span>
                    <span className="font-bold text-xs">{showStationBuffers ? (isMn ? 'Тийм' : 'Yes') : isMn ? 'Үгүй' : 'No'}</span>
                  </button>
                  <button
                    onClick={() => setOverlayState('incidents', !showIncidents)}
                    className="w-full text-left min-h-[40px] px-3 py-1.5 rounded-xl hover:bg-slate-100 text-[#0B124D] flex items-center justify-between"
                  >
                    <span>
                      📍 {isMn ? 'Жишээ дуудлага' : 'Sample calls'} · {DEMO_HISTORICAL_INCIDENTS.length} /{' '}
                      {TOTAL_HISTORICAL_INCIDENTS.toLocaleString()}
                    </span>
                    <span className="font-bold text-xs">{showIncidents ? (isMn ? 'Тийм' : 'Yes') : isMn ? 'Үгүй' : 'No'}</span>
                  </button>
                  <button
                    onClick={() => setOverlayState('heatmap', !showHeatmap)}
                    className="w-full text-left min-h-[40px] px-3 py-1.5 rounded-xl hover:bg-slate-100 text-[#0B124D] flex items-center justify-between"
                  >
                    <span>🔥 {isMn ? 'Загварчилсан дулаан' : 'Modelled heat'}</span>
                    <span className="font-bold text-xs">{showHeatmap ? (isMn ? 'Тийм' : 'Yes') : isMn ? 'Үгүй' : 'No'}</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Inline Weather & UB Average Risk Ticker */}
          <div
            className="hidden xl:flex items-center gap-1.5 ml-auto bg-white/95 px-3 min-h-[44px] rounded-2xl border border-black/[0.08] shadow-md text-xs font-mono shrink-0"
            title={
              live.isLive
                ? `${live.provider} · ${live.lastUpdated}`
                : live.errorReason || (isMn ? 'Сүүлийн кэш / суурь утга' : 'Cached / fallback reading')
            }
          >
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                live.status === 'live'
                  ? 'bg-[#12B89A]'
                  : live.status === 'stale'
                  ? 'bg-amber-500'
                  : 'bg-slate-400'
              }`}
            />
            <span className="text-[#0B124D] font-bold whitespace-nowrap">
              {isMn ? 'УБ' : 'UB'}: {ubAverageRisk}/100
            </span>
            <span className="text-slate-300">·</span>
            <span className="text-[#72778A] whitespace-nowrap">
              {live.windSpeedKmh} {isMn ? 'км/ц' : 'km/h'}
            </span>
            <span className="text-slate-300">·</span>
            <span className="text-[#72778A] whitespace-nowrap">
              <span className={isPanelOpen ? 'hidden 2xl:inline' : ''}>{isMn ? 'Чийг ' : 'RH '}</span>
              {live.humidityPercent}%
            </span>
            <span className="text-slate-300">·</span>
            <span
              className={`font-bold whitespace-nowrap ${
                live.fireWeatherIndex >= 55 ? 'text-[#E93B2F]' : 'text-[#12B89A]'
              }`}
            >
              FWI {live.fireWeatherIndex} · {weatherBadgeText}
            </span>
          </div>
        </div>

        {layerLimitNotice && (
          <div
            role="status"
            className="pointer-events-auto px-3 py-1.5 rounded-xl bg-[#0B124D]/92 text-white text-xs font-medium shadow-md"
          >
            {layerLimitNotice}
          </div>
        )}
      </div>

      {/* GPS / Locate Me Button */}
      <div
        className={`absolute z-[860] flex flex-col items-end gap-1.5 transition-all duration-300 ${
          tileStyle === 'tactical3d'
            ? isPanelOpen
              ? 'top-[146px] right-2.5 sm:top-auto sm:bottom-3 lg:right-[416px]'
              : 'top-[146px] right-2.5 sm:top-auto sm:bottom-3 sm:right-4'
            : isPanelOpen
            ? 'bottom-[170px] right-3 lg:bottom-4 lg:right-[416px]'
            : 'bottom-14 right-3 lg:bottom-4 lg:right-4'
        }`}
      >
        {geoError && (
          <div className="px-2.5 py-1 rounded-xl bg-[#0B124D]/95 text-white text-xs font-mono shadow-lg">
            {geoError}
          </div>
        )}
        <div className="flex items-center gap-2">
          {/* Mobile compact legend toggle (only outside 3D Tactical) */}
          {tileStyle !== 'tactical3d' && (
            <button
              type="button"
              onClick={() => setShowMobileLegend(!showMobileLegend)}
              className="sm:hidden px-3 min-h-[44px] bg-white/95 text-[#0B124D] rounded-full shadow-lg border border-black/[0.08] text-xs font-mono font-bold flex items-center gap-1"
            >
              <span>🔥</span>
              <span>{isMn ? 'Тайлбар' : 'Key'}</span>
            </button>
          )}

          <button
            onClick={handleAnalyzeCurrentArea}
            disabled={geoLocating}
            className="w-11 h-11 bg-white/95 hover:bg-white text-[#0B124D] rounded-full shadow-lg border border-black/[0.08] transition-all active:scale-95 flex items-center justify-center"
            title={isMn ? 'Миний байршлыг олох' : 'Find my location'}
            aria-label={isMn ? 'Миний байршлыг олох' : 'Find my location'}
          >
            <svg
              className={`w-4 h-4 text-[#FF633C] ${geoLocating ? 'animate-spin' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3m0 14v3M2 12h3m14 0h3" />
            </svg>
          </button>
        </div>
      </div>

      {/*
        CHOROPLETH / HEATMAP LEGEND HUD (hidden in 3D Tactical mode where Tactical3DHud + zone circle explain risk)
      */}
      {tileStyle !== 'tactical3d' && (
        <div
          className={`absolute z-[850] bg-white/95 px-3.5 py-2.5 rounded-2xl border border-black/[0.08] shadow-lg text-xs font-mono transition-all ${
            showMobileLegend
              ? 'bottom-[234px] left-2 right-2 flex flex-col gap-1.5 sm:bottom-3 sm:left-[56px] sm:right-auto sm:max-w-lg'
              : 'hidden sm:flex flex-col gap-1.5 bottom-3 left-[56px] max-w-lg pointer-events-none'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-bold text-[#0B124D] uppercase tracking-wide">
                {showHeatmap
                  ? isMn
                    ? 'Загварчилсан дулааны эрсдэл (Modelled)'
                    : 'Modelled Thermal Risk Surface'
                  : isMn
                  ? 'Ангилсан дүүргийн зураглал'
                  : 'Discrete District Choropleth'}
              </span>
              {showHeatmap && (
                <>
                  <span
                    className="w-20 h-2 rounded-full border border-black/10 shrink-0"
                    style={{ background: HEAT_LEGEND_GRADIENT }}
                    aria-hidden="true"
                  />
                  <span className="text-[#72778A]">0–100</span>
                </>
              )}
            </div>
            {showMobileLegend && (
              <button
                type="button"
                onClick={() => setShowMobileLegend(false)}
                className="sm:hidden text-[#72778A] font-bold px-2 py-1"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
            <span className="flex items-center gap-1 font-bold text-[#E93B2F]">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#E93B2F]" /> 75–100 {isMn ? 'Маш өндөр' : 'Very high'}
            </span>
            <span className="flex items-center gap-1 font-bold text-[#FF633C]">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#FF633C]" /> 55–74 {isMn ? 'Өндөр' : 'High'}
            </span>
            <span className="flex items-center gap-1 font-bold text-amber-700">
              <span className="w-2.5 h-2.5 rounded-xs bg-amber-500" /> 35–54 {isMn ? 'Дунд' : 'Mod'}
            </span>
            <span className="flex items-center gap-1 font-bold text-[#0F967E]">
              <span className="w-2.5 h-2.5 rounded-xs bg-[#12B89A]" /> &lt;35 {isMn ? 'Бага' : 'Low'}
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-black/[0.06] text-xs text-[#72778A]">
            <span>
              {showHeatmap
                ? isMn
                  ? `Modelled / Загварчилсан · Хүрээ: ≥56 / ≥68 / ≥78 · Анги: ${UB_FIRE_STATIONS.length}`
                  : `Modelled surface · Isolines: ≥56 / ≥68 / ≥78 · Units: ${UB_FIRE_STATIONS.length}`
                : isMn
                ? `Нийлбэр индекс (0–100) · Демо/Загварчилсан суурь · Анги: ${UB_FIRE_STATIONS.length}`
                : `Composite index (0–100) · Demo/modelled baseline · Units: ${UB_FIRE_STATIONS.length}`}
            </span>
            <span
              ref={hoverReadoutRef}
              style={{ display: 'none' }}
              className="font-bold text-[#0B124D] truncate max-w-[230px]"
            />
          </div>
        </div>
      )}

      {/* 3D Tactical Zoom + 2D/3D Switcher */}
      {tileStyle === 'tactical3d' && (
        <div className="absolute left-2.5 top-[146px] sm:top-auto sm:bottom-3 sm:left-3 z-[865] flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => setIs3DExtruded((prev) => !prev)}
            className={`w-11 h-11 rounded-lg font-mono text-xs font-extrabold border shadow-lg transition-colors flex items-center justify-center ${
              is3DExtruded
                ? 'bg-[#3B82F6] text-white border-blue-400/50'
                : 'bg-[#0F172A]/95 text-slate-200 border-slate-700 hover:bg-slate-800'
            }`}
            title={isMn ? '3D аксонометрик / 2D хавтгай шилжүүлэх' : 'Toggle 3D buildings / 2D plan'}
          >
            {is3DExtruded ? '3D' : '2D'}
          </button>
          <div className="flex flex-col rounded-xl overflow-hidden border border-slate-700/90 bg-[#0F172A]/95 shadow-lg">
            <button
              type="button"
              onClick={() => mapInstanceRef.current?.zoomIn()}
              aria-label="Zoom in"
              className="w-11 h-11 text-slate-100 hover:bg-slate-800 font-bold text-base flex items-center justify-center border-b border-slate-700/80 transition-colors"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => mapInstanceRef.current?.zoomOut()}
              aria-label="Zoom out"
              className="w-11 h-11 text-slate-100 hover:bg-slate-800 font-bold text-base flex items-center justify-center transition-colors"
            >
              −
            </button>
          </div>
        </div>
      )}

      {/* 3D Tactical Bottom-Right Scale & Coord Pill (stacks cleanly above GPS button) */}
      {tileStyle === 'tactical3d' && (
        <div
          className={`hidden sm:flex flex-col items-end gap-1.5 absolute z-[855] pointer-events-none transition-all duration-300 bottom-[64px] ${
            isPanelOpen ? 'lg:right-[416px] right-4' : 'right-4'
          }`}
        >
          <div className="bg-[#0A1122]/92 border border-slate-700/80 rounded-lg px-2.5 py-1 shadow-lg text-center min-w-[96px]">
            <div className="text-xs font-mono font-bold text-slate-100 tabular-nums leading-tight">
              {mapScaleLabel(mapZoom)}
            </div>
            <div className="mt-1 h-[2px] w-full bg-slate-600 relative">
              <div className="absolute inset-y-0 left-0 w-3/4 bg-slate-200" />
            </div>
          </div>
          <div
            ref={coordTextRef}
            className="bg-[#0A1122]/92 border border-slate-700/80 rounded-lg px-2.5 py-1 shadow-lg text-xs font-mono text-slate-200 tabular-nums whitespace-nowrap"
          >
            {(initialDist?.center[0] ?? UB_CENTER_COORDS[0]).toFixed(4)}°N,{' '}
            {(initialDist?.center[1] ?? UB_CENTER_COORDS[1]).toFixed(4)}°E
          </div>
        </div>
      )}

      {/* Crisp Flat Map Stage (zero CSS-tilt blur, zero click coordinate offset!) */}
      <div
        className="w-full h-full relative overflow-hidden"
        style={{
          backgroundColor: tileStyle === 'tactical3d' ? '#060A14' : undefined,
        }}
      >
        <div
          className={`absolute inset-0 ${
            tileStyle === 'tactical3d'
              ? 'fw-tactical3d-map [&_.leaflet-control-container]:opacity-0 [&_.leaflet-control-container]:pointer-events-none'
              : ''
          } ${
            isPanelOpen
              ? '[&_.leaflet-bottom.leaflet-left]:bottom-[168px]! sm:[&_.leaflet-bottom.leaflet-left]:bottom-0!'
              : '[&_.leaflet-bottom.leaflet-left]:bottom-5! sm:[&_.leaflet-bottom.leaflet-left]:bottom-0!'
          }`}
        >
          {/* CRITICAL: Keep static className on mapContainerRef so React never overwrites Leaflet's .leaflet-container */}
          <div ref={mapContainerRef} className="w-full h-full" />
        </div>
      </div>

      {tileStyle === 'tactical3d' && (
        <Tactical3DHud
          isMn={isMn}
          isPanelOpen={isPanelOpen}
          activeDistrict={activeDistrict}
          districtKhoroos={
            activeDistrict
              ? activeDistrictKhoroos
              : [...liveKhoroos].sort((a, b) => b.riskScore - a.riskScore).slice(0, 30)
          }
          selectedKhoroo={selectedKhoroo}
          scene={tacticalScene}
          scenarioStarted={scenarioStarted}
          assumptions={assumptions}
          is3DExtruded={is3DExtruded}
          osmBuildingCount={osmBuildingCount}
          onSelectKhoroo={(kh) => {
            const parentDist = UB_DISTRICTS.find((d) => d.id === kh.districtId);
            if (parentDist && parentDist.id !== activeDistrict?.id) {
              setActiveDistrict(parentDist);
              if (onSelectDistrict) onSelectDistrict(parentDist.id);
            }
            setSelectedKhoroo(kh);
            if (mapInstanceRef.current) {
              focusMap(mapInstanceRef.current, kh.center, 15, 0.42);
            }
          }}
          onToggleScenario={() => {
            setScenarioStarted((prev) => {
              const next = !prev;
              if (next && !selectedKhoroo && activeDistrictKhoroos.length > 0) {
                setSelectedKhoroo(activeDistrictKhoroos[0]);
              }
              return next;
            });
          }}
          onUpdateAssumptions={(next) => setAssumptions(next)}
          onFocusZone={handleFocusTacticalZone}
          onFitStationRoute={handleFitTacticalRoute}
        />
      )}

      <Tactical3DOverlay
        map={mapInstance}
        active={tileStyle === 'tactical3d'}
        is3DExtruded={is3DExtruded}
        isPanelOpen={isPanelOpen}
        scenarioStarted={scenarioStarted}
        assumptions={assumptions}
        activeDistrict={activeDistrict}
        selectedKhoroo={selectedKhoroo}
        khoroos={liveKhoroos}
        stations={UB_FIRE_STATIONS}
        isMn={isMn}
        onSelectKhoroo={(kh) => {
          setSelectedKhoroo(kh);
          setIsPanelOpen(true);
          if (mapInstanceRef.current) {
            focusMap(mapInstanceRef.current, kh.center, 15, 0.42);
          }
        }}
        onOsmCountChange={setOsmBuildingCount}
      />

      <ThermalHeatLayer
        map={mapInstance}
        points={heatPoints}
        visible={showHeatmap && tileStyle !== 'tactical3d'}
        darkBasemap={isDarkBasemap}
        onHoverSample={handleHeatHoverSample}
      />

      {/* Floating Panel Re-Open Button when panel is closed */}
      {!isPanelOpen && activeDistrict && (
        <button
          onClick={() => setIsPanelOpen(true)}
          className="absolute bottom-[104px] right-3 sm:bottom-4 sm:right-16 z-[990] bg-[#0B124D] text-white min-h-[44px] px-4 py-2 rounded-full shadow-2xl flex items-center gap-1.5 sm:gap-2 text-xs font-bold hover:bg-[#11166B] transition-all active:scale-95 border border-white/20 max-w-[calc(100vw-24px)] sm:max-w-[calc(100vw-88px)] truncate"
        >
          <span>📋</span>
          <span className="truncate">
            {isMn
              ? `${activeDistrict.nameMn}: Эрсдэлийн задргаа нээх (${activeDistrict.riskScore}/100)`
              : `${activeDistrict.nameEn}: Open risk breakdown (${activeDistrict.riskScore}/100)`}
          </span>
        </button>
      )}

      {isPanelOpen && activeDistrict && (
        <AreaAnalysisPanel
          district={activeDistrict}
          selectedKhoroo={selectedKhoroo}
          threeAxis={
            selectedKhoroo
              ? fireState.khorooThreeAxis.get(selectedKhoroo.id)
              : fireState.districtThreeAxis.get(activeDistrict.id)
          }
          districtWeather={live.districts[activeDistrict.id] ?? null}
          onSelectKhoroo={(kh) => setSelectedKhoroo(kh)}
          onClose={() => setIsPanelOpen(false)}
          language={language}
          onNavigateToDetail={onNavigateToDetail}
        />
      )}
    </div>
  );
};
