import type { RiskLevel, RiskModelWeights } from '../types';
import { DEFAULT_MODEL_WEIGHTS, clamp, riskLevelFromScore } from '../utils/riskEngine';

export const DEFAULT_RISK_WEIGHTS: RiskModelWeights = { ...DEFAULT_MODEL_WEIGHTS };

export interface RiskVariableMetadata {
  variableId: string;
  code: string;
  weightPercent: number;
  nameMn: string;
  nameEn: string;
  descriptionMn: string;
  descriptionEn: string;
  dataSourceMn: string;
  dataSourceEn: string;
  normalizationFormula: string;
}

export const RISK_VARIABLES_METADATA: RiskVariableMetadata[] = [
  {
    variableId: 'incident_density',
    code: 'V1 · INC',
    weightPercent: 30,
    nameMn: 'Түүхэн дуудлагын нягтрал',
    nameEn: 'Historical Incident Density',
    descriptionMn:
      'Тухайн дүүргийн нутаг дэвсгэрийн нэгж талбайд (км²) ногдох галын дуудлагын харьцангуй нягтрал.',
    descriptionEn:
      'Relative spatial density of logged fire emergency calls per square kilometer of district territory.',
    dataSourceMn: 'Демо суурь өгөгдөл + Админ CSV/JSON импорт',
    dataSourceEn: 'Demo Baseline + Verified Admin CSV/JSON Imports',
    normalizationFormula: 'clamp((incidents / areaKm2 / 3.8) * 100, 10, 100)',
  },
  {
    variableId: 'population_density',
    code: 'V2 · POP',
    weightPercent: 20,
    nameMn: 'Хүн ам ба суурьшлын нягтрал',
    nameEn: 'Population & Settlement Density',
    descriptionMn:
      'Оршин суугчдын бөөгнөрөл, барилга хоорондын зай болон цахилгааны ачааллын өртөмтгий байдал.',
    descriptionEn:
      'Residential crowding, structural spacing exposure, and peak winter/evening electrical grid load.',
    dataSourceMn: 'Улаанбаатарын суурь хүн амын лавлагаа (демо)',
    dataSourceEn: 'UB District Population Reference Baseline (demo)',
    normalizationFormula: 'clamp((population / areaKm2 / 3200) * 100, 10, 100)',
  },
  {
    variableId: 'station_proximity',
    code: 'V3 · STA',
    weightPercent: 15,
    nameMn: 'Гал унтраах ангийн зай',
    nameEn: 'Fire Station Proximity',
    descriptionMn:
      'Хамгийн ойрын гал унтраах, аврах ангиас тухайн бүсийн төв хүртэлх дундаж зорчих зай.',
    descriptionEn:
      'Average straight-line/corridor distance from the nearest NEMA fire & rescue station.',
    dataSourceMn: '14 ангийн лавлах байршил (статик)',
    dataSourceEn: '14 Fire Station Reference Coordinates (static)',
    normalizationFormula: 'clamp((nearestStationDistKm / 8) * 100, 10, 100)',
  },
  {
    variableId: 'ger_proportion',
    code: 'V4 · GER',
    weightPercent: 15,
    nameMn: 'Гэр хорооллын халаалтын хувь',
    nameEn: 'Ger & Solid-Fuel Heating Share',
    descriptionMn:
      'Хатуу түлш, зуух, яндангийн ашиглалт өндөртэй өрхүүдийн эзлэх хувь болон үнс нурмын эрсдэл.',
    descriptionEn:
      'Proportion of households relying on solid-fuel stoves, flue pipes, and outdoor ash storage.',
    dataSourceMn: 'Гэр / орон сууцны бүтцийн лавлагаа (демо)',
    dataSourceEn: 'Household Heating Topology Baseline (demo)',
    normalizationFormula: 'clamp(gerHouseholdPercent, 0, 100)',
  },
  {
    variableId: 'road_access',
    code: 'V5 · ROD',
    weightPercent: 10,
    nameMn: 'Замын нэвтрэх чадвар',
    nameEn: 'Emergency Road Accessibility',
    descriptionMn:
      'Нарийн гудамж, огцом өгсүүр, хашааны зохион байгуулалтаас үүдэх галын машин нэвтрэх саад.',
    descriptionEn:
      'Fire apparatus access constraints across steep slopes, narrow ger-district lanes, and dead ends.',
    dataSourceMn: 'Замын зэрэглэл A–D (суурь үнэлгээ)',
    dataSourceEn: 'District Road Accessibility Grade A–D (baseline)',
    normalizationFormula: 'Grade { A: 24, B: 45, C: 68, D: 85 }',
  },
  {
    variableId: 'seasonal_weather',
    code: 'V6 · WTH',
    weightPercent: 10,
    nameMn: 'Улирал ба цаг агаарын нөхцөл',
    nameEn: 'Seasonal & Live Fire Weather',
    descriptionMn:
      'Агаарын чийгшил буурах, хуурай өдрүүд хуримтлагдах, салхины хурд нэмэгдэх цаг агаарын эрч.',
    descriptionEn:
      'Relative humidity deficit, dry-day persistence, and wind-driven spread index from Open-Meteo.',
    dataSourceMn: 'Open-Meteo бодит цагийн 9 дүүргийн өгөгдөл',
    dataSourceEn: 'Live 9-District Open-Meteo Forecast Telemetry',
    normalizationFormula: 'clamp(0.65 * baseSeasonal + 0.35 * liveFWI, 5, 100)',
  },
];

export interface NormalizedScoreInputs {
  incidentDensityScore: number;
  populationDensityScore: number;
  stationDistanceScore: number;
  gerHouseholdScore: number;
  roadConstraintScore: number;
  weatherFactorScore: number;
}

export function calculateNormalizedScore(
  inputs: NormalizedScoreInputs,
  weights: RiskModelWeights = DEFAULT_RISK_WEIGHTS
): { score: number; level: RiskLevel } {
  const totalWeight =
    weights.incidentHistoryWeight +
    weights.populationDensityWeight +
    weights.stationProximityWeight +
    weights.gerProportionWeight +
    weights.roadAccessibilityWeight +
    weights.seasonalWeatherWeight;

  if (totalWeight <= 0) {
    return { score: 0, level: 'low' };
  }

  const weighted =
    (inputs.incidentDensityScore * weights.incidentHistoryWeight +
      inputs.populationDensityScore * weights.populationDensityWeight +
      inputs.stationDistanceScore * weights.stationProximityWeight +
      inputs.gerHouseholdScore * weights.gerProportionWeight +
      inputs.roadConstraintScore * weights.roadAccessibilityWeight +
      inputs.weatherFactorScore * weights.seasonalWeatherWeight) /
    totalWeight;

  const score = Math.round(clamp(weighted, 0, 100));
  return {
    score,
    level: riskLevelFromScore(score),
  };
}
