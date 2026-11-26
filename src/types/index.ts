export type Language = 'mn' | 'en';
export type ViewMode = 'public' | 'pro';
export type Theme = 'light' | 'dark';
export type ActiveTab = 
  | 'citizen'
  | 'landing' 
  | 'overview' 
  | 'map' 
  | 'explorer' 
  | 'districts' 
  | 'incidents' 
  | 'calendar' 
  | 'emergency' 
  | 'weather' 
  | 'safety' 
  | 'reports' 
  | 'sources'
  | 'personal'
  | 'police';

export type RiskLevel = 'low' | 'moderate' | 'high' | 'very_high';
export type DataOrigin = 'real' | 'demo';
export type LocationConfidence = 'verified_address' | 'district_centroid' | 'synthetic_offset';

export interface FactorContribution {
  id: string;
  nameMn: string;
  nameEn: string;
  weight: number; // percentage of total score
  score: number; // 0 - 100
  contributionValue: number; // weight * score / 100
  impact: 'low' | 'moderate' | 'high';
  descriptionMn: string;
  descriptionEn: string;
}

export interface KhorooData {
  id: string; // e.g. 'bzd-1'
  districtId: string;
  khorooNumber: number;
  nameMn: string;
  nameEn: string;
  center: [number, number]; // [lat, lng]
  population: number;
  households: number;
  gerHouseholdPercent: number;
  apartmentHouseholdPercent: number;
  riskScore: number; // 0 - 100
  riskLevel: RiskLevel;
  primaryRiskFactorMn: string;
  primaryRiskFactorEn: string;
  fireHydrantCount: number;
  roadAccessibility: 'Сайн' | 'Дунд' | 'Муу' | 'Маш муу';
  avgResponseTimeMin: number; // минут
  historicalIncidents2024_2026: number;
  photoUrl: string;
  landmarksMn: string[];
  landmarksEn: string[];
  /** True when the unit is a deterministically modelled khoroo rather than curated data */
  isModelled?: boolean;
  locationConfidence?: LocationConfidence;
}

export interface DistrictData {
  id: string;
  nameMn: string;
  nameEn: string;
  center: [number, number]; // [lat, lng]
  polygon: [number, number][]; // Geo coordinates
  population: number;
  areaKm2: number;
  gerHouseholdPercent: number;
  apartmentHouseholdPercent: number;
  fireStationsCount: number;
  nearestStationDistKm: number;
  roadAccessibilityGrade: 'A' | 'B' | 'C' | 'D';
  historicalIncidentsCount: number;
  riskScore: number; // 0 - 100
  riskLevel: RiskLevel;
  contributions: FactorContribution[];
  trend: 'increasing' | 'stable' | 'decreasing';
  keyObservationsMn: string;
  keyObservationsEn: string;
  khoroosCount: number;
  khoroos?: KhorooData[];
  realWorldPhoto?: string;
  satellitePhoto?: string;
  isModelled?: boolean;
  dataStatus?: 'live' | 'demo' | 'modelled';
  locationConfidence?: LocationConfidence;
}

export interface IncidentRecord {
  id: string;
  date: string;
  districtId: string;
  districtNameMn: string;
  districtNameEn: string;
  khoroo: number;
  category: 'residential_ger' | 'residential_apt' | 'commercial' | 'grass_forest' | 'electrical';
  coordinates: [number, number];
  severity: 'minor' | 'moderate' | 'critical';
  causeGuessMn: string;
  causeGuessEn: string;
  estimatedDamageMnt: number;
  isDemo: boolean;
  dataOrigin?: DataOrigin;
}

export interface FireStation {
  id: string;
  code: string;
  nameMn: string;
  nameEn: string;
  districtId: string;
  addressMn: string;
  addressEn: string;
  coordinates: [number, number];
  vehiclesCount: number;
  personnelActive: number;
  coverageRadiusKm: number;
  servingDistrictsMn: string[];
  servingDistrictsEn: string[];
  locationConfidence?: LocationConfidence;
}

export interface MonthRiskData {
  month: number;
  nameMn: string;
  nameEn: string;
  shortMn: string;
  shortEn: string;
  riskScore: number;
  riskLevel: RiskLevel;
  primaryDriversMn: string[];
  primaryDriversEn: string[];
  historicalAvgIncidents: number;
  avgTempCelsius: number;
  relativeHumidity: number;
  windSpeedKmh: number;
  seasonContextMn: string;
  seasonContextEn: string;
}

export interface WeatherData {
  tempCelsius: number;
  humidityPercent: number;
  windSpeedKmh: number;
  windDirectionDeg: number;
  windDirectionCompass: string;
  condition: 'dry' | 'clear' | 'windy' | 'cold' | 'snow';
  conditionMn: string;
  conditionEn: string;
  fireWeatherIndex: number; // 0 - 100
  droughtDays: number;
  lastUpdated: string;
}

export interface RiskModelWeights {
  incidentHistoryWeight: number; // default 0.30
  populationDensityWeight: number; // default 0.20
  stationProximityWeight: number; // default 0.15
  gerProportionWeight: number; // default 0.15
  roadAccessibilityWeight: number; // default 0.10
  seasonalWeatherWeight: number; // default 0.10
}

export interface DistrictWeatherSnapshot {
  districtId: string;
  observedAtIso: string;
  tempCelsius: number;
  apparentCelsius: number;
  humidityPercent: number;
  windSpeedKmh: number;
  windDirectionDeg: number;
  gustKmh: number;
  precipitationMm: number;
  weatherCode: number;
  droughtDays: number;
  vpdKpa: number;
  fireWeatherIndex: number;
  ignitionReceptivity: number;
  spreadPotential: number;
  provider: string;
  fetchedAtMs: number;
  isLive: boolean;
}

export interface HistoricalWeatherDay {
  districtId: string;
  date: string;
  tempMeanC: number;
  tempMaxC: number;
  rhMinPct: number;
  windMaxKmh: number;
  precipSumMm: number;
  vpdKpa: number;
  droughtDays7d: number;
  lag3dRhMin: number;
  provider: string;
}

export interface ThreeAxisRiskProfile {
  ignitionProbability: {
    unlocked: boolean;
    probabilityPct: number | null;
    ciLowPct: number | null;
    ciHighPct: number | null;
    uncertaintyLabelMn: string;
    uncertaintyLabelEn: string;
    reasonMn: string;
    reasonEn: string;
    modelVersion?: string;
    calibrationEce?: number | null;
  };
  spreadHazard: {
    index: number;
    level: RiskLevel;
    fuelComponent: number;
    weatherSpreadComponent: number;
    dominantDriver: 'dryness' | 'wind' | 'balanced' | 'moisture';
    weatherApplied: boolean;
  };
  responseCapability: {
    readinessScore: number;
    grade: 'A' | 'B' | 'C' | 'D';
    nearestStationDistKm: number;
    estResponseMin: number;
    hydrantCount?: number;
    accessConstraintLabelMn: string;
    accessConstraintLabelEn: string;
  };
  reliability: {
    dataOrigin: 'real_ml' | 'heuristic_with_live_weather' | 'heuristic_baseline';
    confidenceTier: 'high' | 'moderate' | 'low';
    notesMn: string;
    notesEn: string;
  };
}

export interface MlCalibrationBin {
  binIndex: number;
  rangeLabel: string;
  count: number;
  meanPredicted: number;
  observedRate: number;
}

export interface MlFeatureImportance {
  feature: string;
  labelMn: string;
  labelEn: string;
  weight: number;
  absWeight: number;
  direction: 'increases_risk' | 'decreases_risk';
}

export interface MlFeatureProvenance {
  measuredFeatures: string[];
  synthesizedStaticFeatures: string[];
  totalKhoroos: number;
  synthesizedKhorooCount: number;
  curatedKhorooCount: number;
  noteMn: string;
  noteEn: string;
}

export interface MlEvaluationMetrics {
  totalSamples: number;
  trainSamples: number;
  calSamples?: number;
  valSamples: number;
  positiveTrainCount: number;
  positiveCalCount?: number;
  positiveValCount: number;
  trainDateRange: [string, string];
  calDateRange?: [string, string];
  valDateRange: [string, string];
  splitPolicy?: '3_way_chronological';
  rocAuc: number;
  rocAucCi95?: [number, number];
  prAuc: number;
  brierScore: number;
  brierCi95?: [number, number];
  baselineBrierScore: number;
  priorRateBrierScore?: number;
  seasonalBrierScore?: number;
  brierSkillScore: number;
  logLoss: number;
  baselineLogLoss: number;
  priorRateLogLoss?: number;
  seasonalLogLoss?: number;
  ece: number;
  eceCi95?: [number, number];
  ridgeRmse: number;
  ridgeMae: number;
  poissonDeviance?: number;
  poissonRmse?: number;
  poissonMae?: number;
  baseRatePct: number;
  calibrationBins: MlCalibrationBin[];
  featureImportances: MlFeatureImportance[];
  featureProvenance?: MlFeatureProvenance;
}

export interface MlModelArtifact {
  id: string;
  modelVersion: string;
  trainedAtIso: string;
  status: 'validated' | 'rejected_low_quality' | 'insufficient_data';
  gatePassed: boolean;
  gateReasonsMn: string[];
  gateReasonsEn: string[];
  metrics: MlEvaluationMetrics;
  weights: {
    intercept: number;
    coefficients: number[];
    featureNames: string[];
    featureMeans: number[];
    featureStds: number[];
    plattA: number;
    plattB: number;
    weatherMatchedPct: number;
  };
  khorooProbabilities?: Record<string, { probPct: number; ciLowPct: number; ciHighPct: number }>;
}

export interface PublicHeatCluster {
  clusterId: string;
  districtId: string;
  khorooNumber: number;
  lat: number;
  lng: number;
  incidentCount: number;
  criticalCount: number;
  kAnonymitySatisfied: boolean;
  isPublicAggregated: boolean;
}
