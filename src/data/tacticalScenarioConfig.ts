export interface TacticalScenarioAssumptions {
  /** Assumed scenario radius around the selected khoroo focal point (metres). */
  radiusMeters: number;
  /** Straight-line-to-road detour multiplier used for rough route distance estimation. */
  detourFactor: number;
  /** Assumed average urban response speed (km/h) for heavy fire apparatus. */
  avgSpeedKmh: number;
  /** Assumed station turnout & dispatch prep delay (minutes). */
  turnoutDelayMin: number;
}

export const DEFAULT_TACTICAL_ASSUMPTIONS: TacticalScenarioAssumptions = {
  radiusMeters: 250,
  detourFactor: 1.28,
  avgSpeedKmh: 28,
  turnoutDelayMin: 2,
};

export const TACTICAL_ASSUMPTION_BOUNDS = {
  radiusMeters: { min: 100, max: 600, step: 50 },
  detourFactor: { min: 1.0, max: 1.8, step: 0.05 },
  avgSpeedKmh: { min: 15, max: 50, step: 1 },
  turnoutDelayMin: { min: 0, max: 6, step: 1 },
} as const;

export const TACTICAL_RENDER_CONFIG = {
  defaultZoom: 15,
  maxDpr: 2,
  /** Isometric oblique height multiplier at reference zoom Z15 */
  obliqueShiftX: -0.22,
  obliqueShiftY: -0.92,
  maxContextExtrusions: 56,
  maxZoneExtrusions: 32,
} as const;
