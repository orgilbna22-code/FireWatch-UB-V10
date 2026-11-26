import { useMemo, useSyncExternalStore } from 'react';
import { UB_DISTRICTS, UB_KHOROOS } from '../data/ubGeoData';
import type {
  DistrictData,
  KhorooData,
  MlEvaluationMetrics,
  PublicHeatCluster,
  ThreeAxisRiskProfile,
} from '../types';
import { buildApiUrl } from '../utils/apiClient';
import type { DatasetQualityReport } from '../utils/mlDataFoundation';
import {
  computeDistrictThreeAxisRisk,
  computeKhorooDynamicRisk,
  computeKhorooThreeAxisRisk,
  computeWeightedDistrictRisk,
} from '../utils/riskEngine';
import { useLiveWeather } from './liveWeather';

export interface MlStatusSnapshot {
  loaded: boolean;
  gatePassed: boolean;
  mlReadiness: DatasetQualityReport | null;
  latestModel: {
    id: string;
    modelVersion: string;
    trainedAtIso: string;
    status: 'insufficient_data' | 'rejected_low_quality' | 'validated';
    gatePassed: boolean;
    gateReasonsMn: string[];
    gateReasonsEn: string[];
    metrics: MlEvaluationMetrics;
    weatherMatchedPct: number;
  } | null;
  khorooProbabilities: Record<
    string,
    { probPct: number; ciLowPct: number; ciHighPct: number }
  > | null;
  ingestionBatchCount: number;
  historicalWeatherCount: number;
  realIncidentCount: number;
}

interface BackendSyncState {
  ml: MlStatusSnapshot;
  publicClusters: PublicHeatCluster[];
  totalVerifiedIncidents: number;
}

const INITIAL_BACKEND_STATE: BackendSyncState = {
  ml: {
    loaded: false,
    gatePassed: false,
    mlReadiness: null,
    latestModel: null,
    khorooProbabilities: null,
    ingestionBatchCount: 0,
    historicalWeatherCount: 0,
    realIncidentCount: 0,
  },
  publicClusters: [],
  totalVerifiedIncidents: 0,
};

type Listener = () => void;

class FireRiskBackendStore {
  private state: BackendSyncState = INITIAL_BACKEND_STATE;
  private listeners = new Set<Listener>();
  private started = false;
  private inflight: Promise<void> | null = null;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    if (!this.started && typeof window !== 'undefined') {
      this.start();
    }
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): BackendSyncState => this.state;

  private emit() {
    this.listeners.forEach((l) => l());
  }

  public start() {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;
    void this.refresh();
    window.addEventListener('firewatch:incidents-updated', this.handleExternalUpdate);
    window.addEventListener('firewatch:ml-updated', this.handleExternalUpdate);
  }

  private handleExternalUpdate = () => {
    void this.refresh();
  };

  public async refresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    const task = (async () => {
      try {
        const [mlRes, heatRes] = await Promise.all([
          fetch(buildApiUrl('/api/ml/status'), { headers: { Accept: 'application/json' } }),
          fetch(buildApiUrl('/api/incidents/public-heat'), { headers: { Accept: 'application/json' } }),
        ]);

        let nextMl = this.state.ml;
        if (mlRes.ok) {
          const mlJson = (await mlRes.json()) as {
            ok?: boolean;
            mlReadiness?: DatasetQualityReport;
            latestModel?: MlStatusSnapshot['latestModel'];
            gatePassed?: boolean;
            khorooProbabilities?: MlStatusSnapshot['khorooProbabilities'];
            ingestionBatchCount?: number;
            stats?: { historicalWeatherCount?: number; realIncidentCount?: number };
          };
          nextMl = {
            loaded: true,
            gatePassed: Boolean(mlJson.gatePassed),
            mlReadiness: mlJson.mlReadiness ?? null,
            latestModel: mlJson.latestModel ?? null,
            khorooProbabilities: mlJson.gatePassed ? mlJson.khorooProbabilities ?? null : null,
            ingestionBatchCount: mlJson.ingestionBatchCount ?? 0,
            historicalWeatherCount: mlJson.stats?.historicalWeatherCount ?? 0,
            realIncidentCount: mlJson.stats?.realIncidentCount ?? 0,
          };
        }

        let nextClusters = this.state.publicClusters;
        let nextTotalReal = this.state.totalVerifiedIncidents;
        if (heatRes.ok) {
          const heatJson = (await heatRes.json()) as {
            clusters?: PublicHeatCluster[];
            totalVerifiedIncidents?: number;
          };
          nextClusters = Array.isArray(heatJson.clusters) ? heatJson.clusters : [];
          nextTotalReal = heatJson.totalVerifiedIncidents ?? 0;
        }

        this.state = {
          ml: nextMl,
          publicClusters: nextClusters,
          totalVerifiedIncidents: nextTotalReal,
        };
        this.emit();
      } catch {
        // Keep last honest state without throwing UI errors
      }
    })().finally(() => {
      this.inflight = null;
    });
    this.inflight = task;
    return task;
  }
}

export const fireRiskBackendStore = new FireRiskBackendStore();

export function useFireRiskState() {
  const live = useLiveWeather();
  const backend = useSyncExternalStore(
    fireRiskBackendStore.subscribe,
    fireRiskBackendStore.getSnapshot,
    fireRiskBackendStore.getSnapshot
  );

  return useMemo(() => {
    const mlArtifactForRisk =
      backend.ml.latestModel && backend.ml.gatePassed && backend.ml.khorooProbabilities
        ? {
            id: backend.ml.latestModel.id,
            modelVersion: backend.ml.latestModel.modelVersion,
            trainedAtIso: backend.ml.latestModel.trainedAtIso,
            status: backend.ml.latestModel.status,
            gatePassed: backend.ml.latestModel.gatePassed,
            gateReasonsMn: backend.ml.latestModel.gateReasonsMn,
            gateReasonsEn: backend.ml.latestModel.gateReasonsEn,
            metrics: backend.ml.latestModel.metrics,
            weights: {
              intercept: 0,
              coefficients: [],
              featureNames: [],
              featureMeans: [],
              featureStds: [],
              plattA: 1,
              plattB: 0,
              weatherMatchedPct: backend.ml.latestModel.weatherMatchedPct,
            },
            khorooProbabilities: backend.ml.khorooProbabilities,
          }
        : null;

    const districtById = new Map<string, DistrictData>();
    const districtThreeAxis = new Map<string, ThreeAxisRiskProfile>();
    const dynamicDistricts: DistrictData[] = UB_DISTRICTS.map((dist) => {
      const distWeather = live.districts[dist.id] ?? null;
      const fwi = distWeather?.fireWeatherIndex ?? (live.isLive ? live.fireWeatherIndex : undefined);
      const computed = computeWeightedDistrictRisk(dist, undefined, undefined, fwi);
      const axis = computeDistrictThreeAxisRisk({
        district: dist,
        weather: distWeather,
        mlModel: mlArtifactForRisk,
        verifiedRealCount: backend.ml.realIncidentCount,
      });
      districtThreeAxis.set(dist.id, axis);

      const enriched: DistrictData = {
        ...dist,
        riskScore: computed.score,
        riskLevel: computed.level,
        contributions: computed.contributions,
      };
      districtById.set(dist.id, enriched);
      return enriched;
    });

    const cityAverageRisk =
      dynamicDistricts.length > 0
        ? Math.round(dynamicDistricts.reduce((s, d) => s + d.riskScore, 0) / dynamicDistricts.length)
        : 0;

    const realClusterBoost = new Map<string, number>();
    for (const cl of backend.publicClusters) {
      if (cl.kAnonymitySatisfied && cl.khorooNumber > 0) {
        realClusterBoost.set(`${cl.districtId}-${cl.khorooNumber}`, cl.incidentCount);
      }
    }

    const khorooThreeAxis = new Map<string, ThreeAxisRiskProfile>();
    const dynamicKhoroos: KhorooData[] = UB_KHOROOS.map((kh) => {
      const distWeather = live.districts[kh.districtId] ?? null;
      const mlKey = `${kh.districtId}-${kh.khorooNumber}`;
      const dyn = computeKhorooDynamicRisk(kh, distWeather, realClusterBoost.get(mlKey) ?? 0);
      const parentDistrict = districtById.get(kh.districtId) ?? UB_DISTRICTS[0];
      const axis = computeKhorooThreeAxisRisk({
        khoroo: kh,
        district: parentDistrict,
        weather: distWeather,
        mlModel: mlArtifactForRisk,
        verifiedRealCount: backend.ml.realIncidentCount,
      });
      khorooThreeAxis.set(kh.id, axis);

      return {
        ...kh,
        riskScore: dyn.score,
        riskLevel: dyn.level,
      };
    });

    return {
      districts: dynamicDistricts,
      khoroos: dynamicKhoroos,
      cityAverageRisk,
      districtThreeAxis,
      khorooThreeAxis,
      mlStatus: backend.ml,
      publicClusters: backend.publicClusters,
      totalVerifiedIncidents: backend.totalVerifiedIncidents,
      refreshBackend: () => fireRiskBackendStore.refresh(),
    };
  }, [live, backend]);
}
