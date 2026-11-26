import React, { useState } from 'react';
import {
  AlertTriangle,
  Crosshair,
  Play,
  RotateCcw,
  Route,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { DistrictData, KhorooData } from '../../types';
import { Tactical3DScene } from '../../utils/tactical3dData';
import {
  DEFAULT_TACTICAL_ASSUMPTIONS,
  TACTICAL_ASSUMPTION_BOUNDS,
  type TacticalScenarioAssumptions,
} from '../../data/tacticalScenarioConfig';
import { khorooLabel } from '../../i18n/labels';

interface Tactical3DHudProps {
  isMn: boolean;
  isPanelOpen: boolean;
  activeDistrict: DistrictData | null;
  districtKhoroos: KhorooData[];
  selectedKhoroo: KhorooData | null;
  scene: Tactical3DScene | null;
  scenarioStarted: boolean;
  assumptions: TacticalScenarioAssumptions;
  is3DExtruded: boolean;
  osmBuildingCount: number;
  onSelectKhoroo: (kh: KhorooData) => void;
  onToggleScenario: () => void;
  onUpdateAssumptions: (next: TacticalScenarioAssumptions) => void;
  onFocusZone: () => void;
  onFitStationRoute: () => void;
}

export const Tactical3DHud: React.FC<Tactical3DHudProps> = ({
  isMn,
  isPanelOpen,
  activeDistrict,
  districtKhoroos,
  selectedKhoroo,
  scene,
  scenarioStarted,
  assumptions,
  is3DExtruded,
  osmBuildingCount,
  onSelectKhoroo,
  onToggleScenario,
  onUpdateAssumptions,
  onFocusZone,
  onFitStationRoute,
}) => {
  const [showAssumptions, setShowAssumptions] = useState(false);

  const effectiveKhorooId =
    selectedKhoroo?.id ?? scene?.targetKhorooId ?? districtKhoroos[0]?.id ?? '';

  return (
    <>
      {/* 1. Non-dismissible Scenario Notice Banner (always visible in 3D Tactical, zero overlap with right drawer) */}
      <div
        role="region"
        aria-label={isMn ? 'Сценари анхааруулга' : 'Scenario notice'}
        className={`pointer-events-none absolute top-[102px] sm:top-[110px] left-2.5 right-2.5 sm:left-4 z-[865] flex justify-center transition-all duration-300 ${
          isPanelOpen ? 'lg:right-[424px]' : 'lg:right-4'
        }`}
      >
        <div className="pointer-events-auto inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#091124]/94 border border-amber-400/45 shadow-lg backdrop-blur-md text-xs sm:text-xs font-medium text-amber-100 max-w-full">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {isMn
              ? 'СУРГАЛТ / ЗАГВАР СЦЕНАРИ · Бодит гал биш — таамагласан радиус ба ойролцоо тооцоо'
              : 'TRAINING / MODELLED SCENARIO · Not a real fire — assumed radius & rough estimate'}
          </span>
        </div>
      </div>

      {/* 2. Bottom Command Dock (full-width above sheet on mobile; left of right scale/drawer on desktop) */}
      <div
        className={`absolute z-[865] pointer-events-none transition-all duration-300 left-2.5 right-2.5 sm:left-[60px] ${
          isPanelOpen
            ? 'bottom-[170px] sm:bottom-3 lg:right-[620px]'
            : 'bottom-4 sm:bottom-3 sm:right-[210px] lg:right-[230px]'
        }`}
      >
        <div className="relative max-w-xl">
          {/* Collapsible Editable Assumptions Popover */}
          {showAssumptions && (
            <div
              role="dialog"
              aria-label={isMn ? 'Сценарийн таамаглалын тохиргоо' : 'Scenario assumptions'}
              className="pointer-events-auto mb-2.5 bg-[#091124]/96 backdrop-blur-xl border border-sky-400/25 rounded-2xl p-3.5 sm:p-4 shadow-2xl text-white space-y-3 animate-pop-in"
            >
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/10">
                <div>
                  <span className="text-xs font-mono uppercase tracking-wider text-[#FF633C] font-bold block">
                    {isMn ? 'ЗАГВАРЫН ТААМАГЛАЛ (ХЯНАХ БОЛОМЖТОЙ)' : 'EDITABLE MODEL ASSUMPTIONS'}
                  </span>
                  <p className="text-xs text-slate-300">
                    {isMn
                      ? 'Шулуун зай × тойруу хүчин зүйл + ангиас гарах хугацаагаар ойролцоо ETA бодно.'
                      : 'Rough ETA uses straight-line distance × detour factor + station turnout delay.'}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => onUpdateAssumptions({ ...DEFAULT_TACTICAL_ASSUMPTIONS })}
                    className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-mono font-bold text-slate-200 flex items-center gap-1 transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>{isMn ? 'Анхдагч' : 'Reset'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAssumptions(false)}
                    aria-label={isMn ? 'Хаах' : 'Close assumptions'}
                    className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-slate-300"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <label className="block space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300">
                      {isMn ? 'Таамагласан бүсийн радиус' : 'Assumed zone radius'}
                    </span>
                    <span className="font-mono font-bold text-[#FF633C] tabular-nums">
                      {assumptions.radiusMeters} {isMn ? 'м' : 'm'}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={TACTICAL_ASSUMPTION_BOUNDS.radiusMeters.min}
                    max={TACTICAL_ASSUMPTION_BOUNDS.radiusMeters.max}
                    step={TACTICAL_ASSUMPTION_BOUNDS.radiusMeters.step}
                    value={assumptions.radiusMeters}
                    onChange={(e) =>
                      onUpdateAssumptions({ ...assumptions, radiusMeters: Number(e.target.value) })
                    }
                    className="w-full accent-[#FF633C]"
                  />
                </label>

                <label className="block space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300">
                      {isMn ? 'Замын тойруу хүчин зүйл' : 'Road detour multiplier'}
                    </span>
                    <span className="font-mono font-bold text-sky-300 tabular-nums">
                      {assumptions.detourFactor.toFixed(2)}×
                    </span>
                  </div>
                  <input
                    type="range"
                    min={TACTICAL_ASSUMPTION_BOUNDS.detourFactor.min}
                    max={TACTICAL_ASSUMPTION_BOUNDS.detourFactor.max}
                    step={TACTICAL_ASSUMPTION_BOUNDS.detourFactor.step}
                    value={assumptions.detourFactor}
                    onChange={(e) =>
                      onUpdateAssumptions({ ...assumptions, detourFactor: Number(e.target.value) })
                    }
                    className="w-full accent-sky-400"
                  />
                </label>

                <label className="block space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300">
                      {isMn ? 'Дундаж хурд (тооцоот)' : 'Assumed avg speed'}
                    </span>
                    <span className="font-mono font-bold text-emerald-300 tabular-nums">
                      {assumptions.avgSpeedKmh} {isMn ? 'км/ц' : 'km/h'}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={TACTICAL_ASSUMPTION_BOUNDS.avgSpeedKmh.min}
                    max={TACTICAL_ASSUMPTION_BOUNDS.avgSpeedKmh.max}
                    step={TACTICAL_ASSUMPTION_BOUNDS.avgSpeedKmh.step}
                    value={assumptions.avgSpeedKmh}
                    onChange={(e) =>
                      onUpdateAssumptions({ ...assumptions, avgSpeedKmh: Number(e.target.value) })
                    }
                    className="w-full accent-emerald-400"
                  />
                </label>

                <label className="block space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300">
                      {isMn ? 'Ангийн гарах хугацаа' : 'Turnout prep delay'}
                    </span>
                    <span className="font-mono font-bold text-amber-300 tabular-nums">
                      {assumptions.turnoutDelayMin} {isMn ? 'мин' : 'min'}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={TACTICAL_ASSUMPTION_BOUNDS.turnoutDelayMin.min}
                    max={TACTICAL_ASSUMPTION_BOUNDS.turnoutDelayMin.max}
                    step={TACTICAL_ASSUMPTION_BOUNDS.turnoutDelayMin.step}
                    value={assumptions.turnoutDelayMin}
                    onChange={(e) =>
                      onUpdateAssumptions({
                        ...assumptions,
                        turnoutDelayMin: Number(e.target.value),
                      })
                    }
                    className="w-full accent-amber-400"
                  />
                </label>
              </div>
            </div>
          )}

          {/* Main Compact Command Bar */}
          <div className="pointer-events-auto bg-[#091124]/94 backdrop-blur-xl border border-sky-400/25 rounded-2xl p-2 sm:p-3 shadow-2xl text-white space-y-1.5 sm:space-y-2">
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5 sm:gap-2">
              {/* Step 1: Khoroo selector */}
              <div className="flex items-center gap-1.5 flex-1 min-w-[130px]">
                <label htmlFor="tactical-khoroo-select" className="sr-only">
                  {isMn ? 'Сценарийн хороо сонгох' : 'Select scenario khoroo'}
                </label>
                <select
                  id="tactical-khoroo-select"
                  value={effectiveKhorooId}
                  onChange={(e) => {
                    const match = districtKhoroos.find((k) => k.id === e.target.value);
                    if (match) onSelectKhoroo(match);
                  }}
                  className="w-full h-8 px-2 sm:px-2.5 rounded-xl bg-slate-900/95 border border-slate-700 text-xs sm:text-xs font-semibold text-white focus:outline-none focus:ring-2 focus:ring-[#FF633C]"
                >
                  {districtKhoroos.map((kh) => (
                    <option key={kh.id} value={kh.id} className="bg-slate-900 text-white">
                      {activeDistrict ? `${isMn ? activeDistrict.nameMn : activeDistrict.nameEn} · ` : ''}
                      {khorooLabel(kh.khorooNumber, isMn)} ({kh.riskScore}/100)
                    </option>
                  ))}
                </select>
              </div>

              {/* Step 2: Primary Start / Reset Scenario Button */}
              <button
                type="button"
                data-testid="tactical-start-btn"
                onClick={onToggleScenario}
                className={`h-8 px-2.5 sm:px-3 rounded-xl text-xs sm:text-xs font-bold flex items-center gap-1 sm:gap-1.5 transition-all shrink-0 shadow-sm ${
                  scenarioStarted
                    ? 'bg-slate-800 hover:bg-slate-700 text-amber-200 border border-amber-400/40'
                    : 'bg-[#FF633C] hover:bg-[#e4522d] text-white'
                }`}
              >
                {scenarioStarted ? (
                  <>
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span className="sm:hidden">{isMn ? 'Зогсоох' : 'Reset'}</span>
                    <span className="hidden sm:inline">{isMn ? 'Сценари зогсоох' : 'Reset scenario'}</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span className="sm:hidden">{isMn ? 'Эхлүүлэх' : 'Start'}</span>
                    <span className="hidden sm:inline">{isMn ? 'Сценари эхлүүлэх' : 'Start scenario'}</span>
                  </>
                )}
              </button>

              {/* Camera Focus + Route Fit + Assumptions Toggle */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={onFocusZone}
                  title={isMn ? 'Сонгосон хорооны 3D бүс рүү төвлөрөх' : 'Focus 3D khoroo zone'}
                  className="h-8 px-2 sm:px-2.5 rounded-xl bg-white/10 hover:bg-white/18 text-slate-100 text-xs font-semibold flex items-center gap-1 transition-colors"
                >
                  <Crosshair className="w-3.5 h-3.5 text-sky-300" />
                  <span className="hidden md:inline">{isMn ? 'Бүс' : 'Zone'}</span>
                </button>
                {scenarioStarted && (
                  <button
                    type="button"
                    onClick={onFitStationRoute}
                    title={isMn ? 'Ойрын анги болон чиглэлийг бүтэн харах' : 'Fit nearest station & corridor'}
                    className="h-8 px-2 sm:px-2.5 rounded-xl bg-white/10 hover:bg-white/18 text-slate-100 text-xs font-semibold flex items-center gap-1 transition-colors"
                  >
                    <Route className="w-3.5 h-3.5 text-emerald-300" />
                    <span className="hidden md:inline">{isMn ? 'Анги+Зам' : 'Route'}</span>
                  </button>
                )}
                <button
                  type="button"
                  aria-expanded={showAssumptions}
                  onClick={() => setShowAssumptions((v) => !v)}
                  title={isMn ? 'Радиус ба хурдны таамаглал засах' : 'Edit radius & ETA assumptions'}
                  className={`h-8 px-2 sm:px-2.5 rounded-xl text-xs font-semibold flex items-center gap-1 transition-colors border ${
                    showAssumptions
                      ? 'bg-sky-500/25 border-sky-400 text-white'
                      : 'bg-white/10 hover:bg-white/18 border-transparent text-slate-100'
                  }`}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5 text-[#FF633C]" />
                  <span className="hidden sm:inline">{isMn ? 'Таамаглал' : 'Assumptions'}</span>
                </button>
              </div>
            </div>

            {/* Plain-language Status + Legend Bar */}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-1.5 border-t border-white/10 text-xs font-mono text-slate-300">
              {scenarioStarted && scene ? (
                <div className="flex items-center gap-x-2.5 min-w-0 truncate">
                  <span className="flex items-center gap-1 text-white font-bold shrink-0">
                    <span className="w-2 h-2 rounded-full bg-[#FF633C]" />
                    r={scene.scenarioRadiusMeters}{isMn ? 'м' : 'm'}
                  </span>
                  <span className="flex items-center gap-1 text-emerald-300 font-bold truncate">
                    <span>🚒</span>
                    <span className="truncate">
                      {isMn
                        ? `${scene.nearestStation.nameMn} · ~${scene.etaMin} мин (~${scene.distanceKm} км)`
                        : `${scene.nearestStation.nameEn} · ~${scene.etaMin} min (~${scene.distanceKm} km)`}
                    </span>
                  </span>
                </div>
              ) : (
                <span className="text-sky-200 truncate">
                  {isMn
                    ? 'Хороо сонгоод «Эхлүүлэх» дарж радиус ба чиглэлийг харна уу.'
                    : 'Pick a khoroo and press "Start" to preview assumed zone & corridor.'}
                </span>
              )}

              <div className="hidden sm:flex items-center gap-2.5 text-xs text-slate-400 ml-auto shrink-0">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-xs bg-sky-400/70 inline-block" />
                  {osmBuildingCount > 0
                    ? isMn
                      ? `OSM ${osmBuildingCount} барилга`
                      : `OSM ${osmBuildingCount} bldgs`
                    : isMn
                    ? 'Суурь барилга'
                    : 'Context massing'}
                </span>
                <span>· {is3DExtruded ? '3D Axonometric' : '2D Plan'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
