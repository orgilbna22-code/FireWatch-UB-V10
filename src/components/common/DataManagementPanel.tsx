import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  CloudRain,
  Cpu,
  Database,
  Download,
  Edit3,
  FileSpreadsheet,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { IncidentRecord, Language, MlEvaluationMetrics } from '../../types';
import { DEMO_HISTORICAL_INCIDENTS, UB_DISTRICTS } from '../../data/ubGeoData';
import { liveWeather } from '../../hooks/liveWeather';
import { safeFetchJson } from '../../utils/apiClient';
import {
  computeCommandDataQuality,
  DatasetSourceMode,
  getEffectivePilotPartner,
  useFireCommandSettings,
} from '../../utils/fireCommandSettings';
import { getUbDateIso } from '../../utils/ubTime';
import { buildCleanTrainingDataset, DatasetQualityReport } from '../../utils/mlDataFoundation';
import { NEMA_CSV_TEMPLATE } from '../../utils/incidentCsvParser';
import type { DataOrigin } from '../../types';

interface DataManagementPanelProps {
  language: Language;
  adminToken: string;
  onLock?: () => void;
}

interface ManagedIncidentRow {
  id: string;
  date: string;
  districtId: string;
  khorooNumber: number;
  category: IncidentRecord['category'];
  severity: IncidentRecord['severity'];
  causeGuessMn: string;
  causeGuessEn: string;
  responseTimeMin: number;
  lat: number;
  lng: number;
  coordinates: [number, number];
  source: string;
  dataOrigin?: DataOrigin;
  createdAtIso: string;
}

interface DbStatusResponse {
  ok: boolean;
  stats: {
    weatherCount: number;
    historicalWeatherCount?: number;
    homeAuditCount: number;
    incidentCount: number;
    realIncidentCount?: number;
    aiCacheCount: number;
  };
  latestWeatherTimestamp: string | null;
  latestWeatherProvider: string | null;
  hasGemini: boolean;
  serverTimeIso: string;
}

interface ImportPreviewResponse {
  ok: boolean;
  dryRun: boolean;
  format: 'csv' | 'json';
  totalRows: number;
  validNewCount: number;
  insertedCount: number;
  duplicateCount: number;
  rejectedCount: number;
  piiRejectedCount: number;
  rejectedSample: Array<{ rowIndex: number; reasons: string[]; snippet: string }>;
  detectedColumns: string[];
  mappedFields: Record<string, string>;
  weatherSync?: {
    fetchedDays: number;
    districtsSynced: number;
    cachedTotal: number;
    errors: string[];
  } | null;
}

interface IngestionBatchRow {
  id: string;
  createdAtIso: string;
  format: 'csv' | 'json';
  sourceName: string;
  totalRows: number;
  insertedRows: number;
  duplicateRows: number;
  rejectedRows: number;
  piiRejectedRows: number;
}

interface MlStatusPayload {
  ok: boolean;
  mlReadiness: DatasetQualityReport;
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
  gatePassed: boolean;
  ingestionBatchCount: number;
  stats: DbStatusResponse['stats'];
}

const SAMPLE_GEOJSON_PAYLOAD = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'nema-sync-2026-01',
      geometry: { type: 'Point', coordinates: [107.0112, 47.9408] },
      properties: {
        date: '2026-11-15',
        districtId: 'bayanzurkh',
        khorooNumber: 27,
        category: 'residential_ger',
        severity: 'critical',
        causeGuessMn: 'Зуухны яндангийн цонолт (Синхрон)',
        causeGuessEn: 'Stove flue overheating (Synced)',
        responseTimeMin: 11,
      },
    },
    {
      type: 'Feature',
      id: 'nema-sync-2026-02',
      geometry: { type: 'Point', coordinates: [106.7875, 47.9452] },
      properties: {
        date: '2026-11-14',
        districtId: 'songinokhairkhan',
        khorooNumber: 24,
        category: 'electrical',
        severity: 'moderate',
        causeGuessMn: 'Цахилгаан халаагуурын богино холболт',
        causeGuessEn: 'Space heater short circuit',
        responseTimeMin: 13,
      },
    },
  ],
};

const ManagedIncidentTableRow = React.memo<{
  row: ManagedIncidentRow;
  districtLabel: string;
  isMn: boolean;
  deleting: boolean;
  onEdit: (row: ManagedIncidentRow) => void;
  onDelete: (id: string) => void;
}>(({ row, districtLabel, isMn, deleting, onEdit, onDelete }) => (
  <tr className="hover:bg-[#F7F8FA]">
    <td className="py-2 px-3 font-mono whitespace-nowrap text-[#72778A]">{row.date}</td>
    <td className="py-2 px-3 whitespace-nowrap font-semibold text-[#0B124D]">
      {districtLabel} · {row.khorooNumber}-р
    </td>
    <td className="py-2 px-3 text-[#0B124D] max-w-[260px] truncate">{row.causeGuessMn}</td>
    <td className="py-2 px-3 font-mono text-xs text-[#72778A]">
      <span
        className={`px-1.5 py-0.5 rounded font-bold mr-1.5 ${
          row.dataOrigin === 'real'
            ? 'bg-emerald-100 text-emerald-900'
            : 'bg-amber-100 text-amber-900'
        }`}
      >
        {row.dataOrigin === 'real' ? 'REAL' : 'DEMO'}
      </span>
      {row.source}
    </td>
    <td className="py-2 px-3 text-right whitespace-nowrap">
      <button
        type="button"
        onClick={() => onEdit(row)}
        className="p-2 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg hover:bg-slate-200 text-[#0B124D] mr-1"
        title={isMn ? 'Засах' : 'Edit'}
        aria-label={`Edit ${row.id}`}
      >
        <Edit3 className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onDelete(row.id)}
        disabled={deleting}
        className="p-2 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg hover:bg-red-100 text-[#E93B2F] disabled:opacity-50"
        title={isMn ? 'Устгах' : 'Delete'}
        aria-label={`Delete ${row.id}`}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </td>
  </tr>
));

export const DataManagementPanel: React.FC<DataManagementPanelProps> = ({
  language,
  adminToken,
  onLock,
}) => {
  const isMn = language === 'mn';
  const authHeader = { Authorization: `Bearer ${adminToken}` };

  const [status, setStatus] = useState<DbStatusResponse | null>(null);
  const [incidents, setIncidents] = useState<ManagedIncidentRow[]>([]);
  const [mlStatusPayload, setMlStatusPayload] = useState<MlStatusPayload | null>(null);
  const [batches, setBatches] = useState<IngestionBatchRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [visibleLimit, setVisibleLimit] = useState<number>(25);

  useEffect(() => {
    setVisibleLimit(25);
  }, [searchTerm]);
  const [showBatchImport, setShowBatchImport] = useState<boolean>(false);
  const [importFormat, setImportFormat] = useState<'csv' | 'json'>('csv');
  const [importSourceName, setImportSourceName] = useState<string>('NEMA-UB');
  const [batchJsonText, setBatchJsonText] = useState<string>(NEMA_CSV_TEMPLATE);
  const [importPreview, setImportPreview] = useState<ImportPreviewResponse | null>(null);
  const {
    datasetMode,
    pilotPartner,
    updateDatasetMode,
    updatePilotPartner,
  } = useFireCommandSettings();
  const [pilotDraft, setPilotDraft] = useState<string>(pilotPartner);

  useEffect(() => {
    setPilotDraft(pilotPartner);
  }, [pilotPartner]);

  const qualitySummary = useMemo(
    () => computeCommandDataQuality(incidents, DEMO_HISTORICAL_INCIDENTS),
    [incidents]
  );
  const mlReadiness = useMemo(
    () => mlStatusPayload?.mlReadiness ?? buildCleanTrainingDataset(incidents),
    [incidents, mlStatusPayload]
  );
  const effectivePartner = useMemo(
    () => getEffectivePilotPartner(language, pilotPartner),
    [language, pilotPartner]
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formDate, setFormDate] = useState<string>(() => getUbDateIso());
  const [formDistrictId, setFormDistrictId] = useState<string>('bayanzurkh');
  const [formKhorooNumber, setFormKhorooNumber] = useState<number>(27);
  const [formCategory, setFormCategory] = useState<IncidentRecord['category']>('residential_ger');
  const [formSeverity, setFormSeverity] = useState<IncidentRecord['severity']>('moderate');
  const [formResponseMin, setFormResponseMin] = useState<number>(12);
  const [formDataOrigin, setFormDataOrigin] = useState<DataOrigin>('demo');
  const [formCauseMn, setFormCauseMn] = useState<string>('');
  const [formLat, setFormLat] = useState<string>('47.9408');
  const [formLng, setFormLng] = useState<string>('107.0112');

  const notifyUpdated = () => {
    window.dispatchEvent(new CustomEvent('firewatch:incidents-updated'));
    window.dispatchEvent(new CustomEvent('firewatch:ml-updated'));
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, incRes, mlRes, batchRes] = await Promise.all([
        safeFetchJson<DbStatusResponse>(
          '/api/data-management/status',
          { headers: { Authorization: `Bearer ${adminToken}` } },
          language,
          8000
        ),
        safeFetchJson<{
          incidents: Array<{
            id: string;
            date: string;
            districtId: string;
            khorooNumber: number;
            category: IncidentRecord['category'];
            severity: IncidentRecord['severity'];
            causeGuessMn: string;
            causeGuessEn: string;
            responseTimeMin: number;
            lat: number;
            lng: number;
            source: string;
            dataOrigin?: DataOrigin;
            createdAtIso: string;
          }>;
        }>('/api/incidents', {}, language, 8000),
        safeFetchJson<MlStatusPayload>('/api/ml/status', {}, language, 8000),
        safeFetchJson<{ batches: IngestionBatchRow[] }>(
          '/api/data-management/batches',
          { headers: { Authorization: `Bearer ${adminToken}` } },
          language,
          8000
        ),
      ]);
      if (!statusRes.ok && (statusRes.status === 401 || statusRes.status === 403)) {
        onLock?.();
        throw new Error(isMn ? 'Админ эрх хүчингүй боллоо.' : 'Admin session expired or unauthorized.');
      }
      if (!statusRes.ok) throw new Error(statusRes.error);
      if (!incRes.ok) throw new Error(incRes.error);

      setStatus(statusRes.data);
      if (mlRes.ok) setMlStatusPayload(mlRes.data);
      if (batchRes.ok) setBatches(batchRes.data.batches ?? []);
      setIncidents(
        (incRes.data.incidents || []).map((row) => ({
          ...row,
          dataOrigin: row.dataOrigin === 'real' ? 'real' : 'demo',
          coordinates: [row.lat, row.lng] as [number, number],
        }))
      );
      setFeedback((cur) => (cur?.type === 'err' ? null : cur));
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : isMn ? 'Сервертэй холбогдож чадсангүй' : 'Failed to load data',
      });
    } finally {
      setLoading(false);
    }
  }, [adminToken, isMn, language, onLock]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const showToast = (type: 'ok' | 'err', text: string) => {
    setFeedback({ type, text });
    window.setTimeout(() => {
      setFeedback((cur) => (cur?.text === text ? null : cur));
    }, 4500);
  };

  const resetForm = () => {
    setEditingId(null);
    setFormDate(getUbDateIso());
    setFormDistrictId('bayanzurkh');
    setFormKhorooNumber(27);
    setFormCategory('residential_ger');
    setFormSeverity('moderate');
    setFormResponseMin(12);
    setFormDataOrigin('demo');
    setFormCauseMn('');
  };

  const handleSaveIncident = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formCauseMn.trim()) {
      showToast('err', isMn ? 'Шалтгаан / тайлбарыг бөглөнө үү.' : 'Please enter a cause or description.');
      return;
    }

    setBusyAction('save');
    try {
      const dist = UB_DISTRICTS.find((d) => d.id === formDistrictId) || UB_DISTRICTS[0];
      const latNum = Number(formLat);
      const lngNum = Number(formLng);
      const payload = {
        date: formDate,
        districtId: formDistrictId,
        khorooNumber: formKhorooNumber,
        category: formCategory,
        severity: formSeverity,
        responseTimeMin: formResponseMin,
        dataOrigin: formDataOrigin,
        causeGuessMn: formCauseMn.trim(),
        causeGuessEn: formCauseMn.trim(),
        lat: formDataOrigin === 'real' ? latNum : Number.isFinite(latNum) ? latNum : dist.center[0],
        lng: formDataOrigin === 'real' ? lngNum : Number.isFinite(lngNum) ? lngNum : dist.center[1],
      };

      const url = editingId ? `/api/incidents/${encodeURIComponent(editingId)}` : '/api/incidents';
      const method = editingId ? 'PUT' : 'POST';

      const result = await safeFetchJson<{ ok?: boolean }>(
        url,
        {
          method,
          headers: { 'Content-Type': 'application/json', ...authHeader },
          body: JSON.stringify(payload),
        },
        language,
        10_000
      );
      if (!result.ok) {
        if (result.status === 401 || result.status === 403) onLock?.();
        throw new Error(result.error);
      }

      showToast(
        'ok',
        editingId
          ? isMn
            ? 'Бүртгэл амжилттай шинэчлэгдлээ.'
            : 'Incident record updated.'
          : isMn
          ? 'Шинэ дуудлагын бүртгэл SQLite санд хадгалагдлаа.'
          : 'New incident record saved to SQLite.'
      );
      resetForm();
      await loadAll();
      notifyUpdated();
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteIncident = async (id: string) => {
    setBusyAction(`del:${id}`);
    try {
      const result = await safeFetchJson<{ deleted?: boolean }>(
        `/api/incidents/${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
          headers: authHeader,
        },
        language,
        8000
      );
      if (!result.ok) {
        if (result.status === 401 || result.status === 403) onLock?.();
        throw new Error(result.error);
      }
      if (editingId === id) resetForm();
      showToast('ok', isMn ? 'Бүртгэл устгагдлаа.' : 'Record deleted.');
      await loadAll();
      notifyUpdated();
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleEditStart = (row: ManagedIncidentRow) => {
    setEditingId(row.id);
    setFormDate(row.date);
    setFormDistrictId(row.districtId);
    setFormKhorooNumber(row.khorooNumber);
    setFormCategory(row.category);
    setFormSeverity(row.severity);
    setFormResponseMin(row.responseTimeMin);
    setFormDataOrigin(row.dataOrigin === 'real' ? 'real' : 'demo');
    setFormCauseMn(row.causeGuessMn);
    setFormLat(String(row.lat));
    setFormLng(String(row.lng));
  };

  const handleStructuredImport = async (dryRun: boolean) => {
    const raw = batchJsonText.trim();
    if (!raw) {
      showToast('err', isMn ? 'CSV эсвэл JSON өгөгдөл оруулна уу.' : 'Paste CSV or JSON data first.');
      return;
    }

    let payloadToSend: string | unknown = raw;
    let detectedFormat: 'csv' | 'json' = importFormat;
    if (importFormat === 'json' || raw.startsWith('{') || raw.startsWith('[')) {
      try {
        payloadToSend = JSON.parse(raw);
        detectedFormat = 'json';
      } catch {
        if (importFormat === 'json') {
          showToast('err', isMn ? 'JSON бүтэц буруу байна.' : 'Invalid JSON syntax.');
          return;
        }
        detectedFormat = 'csv';
      }
    }

    setBusyAction(dryRun ? 'dry-run' : 'import-commit');
    try {
      const result = await safeFetchJson<ImportPreviewResponse>(
        '/api/v1/incidents/import',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader },
          body: JSON.stringify({
            format: detectedFormat,
            sourceName: importSourceName.trim() || 'NEMA-UB',
            payload: payloadToSend,
            dryRun,
            enrichWeather: !dryRun,
          }),
        },
        language,
        30_000
      );
      if (!result.ok) {
        if (result.status === 401 || result.status === 403) onLock?.();
        throw new Error(result.error);
      }

      setImportPreview(result.data);
      if (dryRun) {
        showToast(
          'ok',
          isMn
            ? `Шалгалт дууслаа: ${result.data.validNewCount} шинэ мөр бэлэн (давхардсан: ${result.data.duplicateCount}, татгалзсан: ${result.data.rejectedCount}).`
            : `Dry-run complete: ${result.data.validNewCount} valid new rows (${result.data.duplicateCount} duplicates, ${result.data.rejectedCount} rejected).`
        );
      } else {
        showToast(
          'ok',
          isMn
            ? `Бодит өгөгдөл хадгалагдлаа: ${result.data.insertedCount} бичлэг · Open-Meteo архиваас ${result.data.weatherSync?.fetchedDays ?? 0} хоногийн цаг агаар холбогдлоо.`
            : `Imported ${result.data.insertedCount} verified rows · Synced ${result.data.weatherSync?.fetchedDays ?? 0} Open-Meteo archive weather days.`
        );
        await loadAll();
        notifyUpdated();
      }
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSyncHistoricalWeather = async () => {
    setBusyAction('hist-weather');
    try {
      const result = await safeFetchJson<{
        fetchedDays: number;
        districtsSynced: number;
        cachedTotal: number;
        errors: string[];
      }>(
        '/api/ml/sync-historical-weather',
        { method: 'POST', headers: authHeader },
        language,
        30_000
      );
      if (!result.ok) {
        if (result.status === 401 || result.status === 403) onLock?.();
        throw new Error(result.error);
      }
      await loadAll();
      showToast(
        'ok',
        isMn
          ? `Open-Meteo Archive: ${result.data.fetchedDays} шинэ хоног (${result.data.districtsSynced} дүүрэг), нийт ${result.data.cachedTotal} бичлэг хадгалагдлаа.`
          : `Archive Weather synced: ${result.data.fetchedDays} new days (${result.data.districtsSynced} districts), ${result.data.cachedTotal} total cached.`
      );
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Archive weather sync failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleTrainMlModel = async () => {
    setBusyAction('ml-train');
    try {
      const result = await safeFetchJson<{
        ok: boolean;
        model: {
          status: string;
          gatePassed: boolean;
          gateReasonsMn: string[];
          gateReasonsEn: string[];
        };
      }>(
        '/api/ml/train',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader },
          body: JSON.stringify({ syncWeather: false }),
        },
        language,
        25_000
      );
      if (!result.ok) {
        if (result.status === 401 || result.status === 403) onLock?.();
        throw new Error(result.error);
      }
      await loadAll();
      notifyUpdated();
      showToast(
        result.data.model.gatePassed ? 'ok' : 'err',
        isMn
          ? result.data.model.gateReasonsMn[0] ?? 'ML сургалт дууслаа.'
          : result.data.model.gateReasonsEn[0] ?? 'ML training completed.'
      );
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'ML training failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleDownloadCsvTemplate = () => {
    const blob = new Blob([`\uFEFF${NEMA_CSV_TEMPLATE}\n`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'firewatch-ub-nema-template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isJson = file.name.toLowerCase().endsWith('.json') || file.name.toLowerCase().endsWith('.geojson');
    setImportFormat(isJson ? 'json' : 'csv');
    setImportPreview(null);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setBatchJsonText(reader.result);
      }
    };
    reader.readAsText(file);
  };

  const handleForceWeatherRefresh = async () => {
    setBusyAction('weather');
    try {
      await liveWeather.refresh();
      await loadAll();
      showToast('ok', isMn ? 'Цаг агаарын шууд мэдээлэл шинэчлэгдлээ.' : 'Live weather observation synced.');
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Weather sync failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleClearAiCache = async () => {
    setBusyAction('cache');
    try {
      const result = await safeFetchJson<{ cleared?: number }>(
        '/api/data-management/ai-cache',
        {
          method: 'DELETE',
          headers: authHeader,
        },
        language,
        8000
      );
      if (!result.ok) {
        if (result.status === 401 || result.status === 403) onLock?.();
        throw new Error(result.error);
      }
      await loadAll();
      showToast(
        'ok',
        isMn ? `AI кэш цэвэрлэгдлээ (${result.data.cleared ?? 0} бичлэг).` : `Cleared ${result.data.cleared ?? 0} AI cache entries.`
      );
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Failed to clear cache');
    } finally {
      setBusyAction(null);
    }
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), incidents }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `firewatch-ub-incidents-${getUbDateIso()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const filteredIncidents = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    if (!q) return incidents;
    return incidents.filter(
      (i) =>
        i.causeGuessMn.toLowerCase().includes(q) ||
        i.districtId.toLowerCase().includes(q) ||
        i.date.includes(q) ||
        i.category.toLowerCase().includes(q)
    );
  }, [incidents, searchTerm]);

  const districtName = (id: string) => {
    const match = UB_DISTRICTS.find((d) => d.id === id);
    return match ? (isMn ? match.nameMn : match.nameEn) : id;
  };

  return (
    <div className="space-y-4 text-xs">
      {/* Feedback Banner */}
      {feedback && (
        <div
          role="status"
          className={`px-3.5 py-2.5 rounded-xl border flex items-center justify-between gap-2 font-medium ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          <span className="flex items-center gap-2">
            {feedback.type === 'ok' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
            <span>{feedback.text}</span>
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {feedback.type === 'err' && (
              <button
                type="button"
                onClick={() => void loadAll()}
                className="px-3 py-1.5 min-h-[44px] rounded-lg bg-white border border-red-300 text-xs font-bold text-red-700 hover:bg-red-100"
              >
                {isMn ? 'Дахин оролдох' : 'Retry'}
              </button>
            )}
            <button onClick={() => setFeedback(null)} aria-label="Dismiss" className="w-11 h-11 flex items-center justify-center opacity-70 hover:opacity-100">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Live SQLite & Sync Overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="p-3 rounded-xl bg-[#F7F8FA] border border-slate-200">
          <span className="text-xs font-mono text-[#72778A] block">
            {isMn ? 'Бүртгэсэн дуудлага' : 'Managed Incidents'}
          </span>
          <span className="font-mono text-lg font-bold text-[#0B124D] tabular-nums">
            {status?.stats.incidentCount ?? incidents.length}
          </span>
        </div>
        <div className="p-3 rounded-xl bg-[#F7F8FA] border border-slate-200">
          <span className="text-xs font-mono text-[#72778A] block">
            {isMn ? 'Цаг агаарын бичлэг' : 'Weather Logs'}
          </span>
          <span className="font-mono text-lg font-bold text-[#0B124D] tabular-nums">
            {status?.stats.weatherCount ?? '—'}
          </span>
        </div>
        <div className="p-3 rounded-xl bg-[#F7F8FA] border border-slate-200">
          <span className="text-xs font-mono text-[#72778A] block">
            {isMn ? 'Өрхийн үнэлгээ' : 'Home Audits'}
          </span>
          <span className="font-mono text-lg font-bold text-[#0B124D] tabular-nums">
            {status?.stats.homeAuditCount ?? '—'}
          </span>
        </div>
        <div className="p-3 rounded-xl bg-[#F7F8FA] border border-slate-200">
          <span className="text-xs font-mono text-[#72778A] block">
            {isMn ? 'AI кэш бичлэг' : 'AI Cache Rows'}
          </span>
          <span className="font-mono text-lg font-bold text-[#FF633C] tabular-nums">
            {status?.stats.aiCacheCount ?? '—'}
          </span>
        </div>
      </div>

      {/* Fire Command Controls: Dataset Toggle & Configurable Pilot Partner */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="p-3.5 rounded-xl bg-white border border-slate-200 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-[#0B124D]">
              {isMn ? 'Өгөгдлийн эх сурвалжийн горим' : 'Active Dataset Scope'}
            </span>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-bold">
              {datasetMode === 'imported'
                ? isMn
                  ? 'ЗӨВХӨН ИМПОРТ'
                  : 'IMPORTED ONLY'
                : datasetMode === 'demo'
                  ? isMn
                    ? 'ЗӨВХӨН ЖИШЭЭ'
                    : 'DEMO ONLY'
                  : isMn
                    ? 'ХОСОЛСОН'
                    : 'COMBINED'}
            </span>
          </div>
          <p className="text-xs text-[#72778A]">
            {isMn
              ? 'Дуудлагын түүх болон тайланд импортолсон SQLite бүртгэлийг жишээ өгөгдлөөс салгаж эсвэл хамт харуулах сонголт.'
              : 'Separate imported SQLite incident rows from bundled demo baselines across tables and exports.'}
          </p>
          <div className="grid grid-cols-3 gap-1.5" role="group" aria-label={isMn ? 'Өгөгдлийн горим' : 'Dataset scope'}>
            {(
              [
                { id: 'combined', mn: 'Хосолсон', en: 'Combined' },
                { id: 'imported', mn: 'Импорт (SQLite)', en: 'Imported' },
                { id: 'demo', mn: 'Жишээ (Demo)', en: 'Demo Only' },
              ] as Array<{ id: DatasetSourceMode; mn: string; en: string }>
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                aria-pressed={datasetMode === opt.id}
                onClick={() => updateDatasetMode(opt.id)}
                className={`py-2 px-2 min-h-[44px] rounded-lg text-xs font-bold border transition-colors ${
                  datasetMode === opt.id
                    ? 'bg-[#0B124D] text-white border-[#0B124D]'
                    : 'bg-[#F7F8FA] text-[#72778A] border-slate-200 hover:text-[#0B124D]'
                }`}
              >
                {isMn ? opt.mn : opt.en}
              </button>
            ))}
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-white border border-slate-200 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-[#0B124D]">
              {isMn ? 'Туршилтын түнш (Тохируулах)' : 'Configurable Pilot Partner'}
            </span>
            <span className="text-xs font-mono text-[#72778A]">
              {effectivePartner.isConfigured ? (isMn ? 'Хадгалагдсан' : 'Configured') : isMn ? 'Хоосон' : 'Default'}
            </span>
          </div>
          <p className="text-xs text-[#72778A]">
            {isMn
              ? 'Тайлангийн толгой дээр харагдах хамтрагч нэгжийн нэр (албан ёсны ОБЕГ-ын баталгаа биш).'
              : 'Local unit or pilot partner label displayed on exported reports (not an official endorsement).'}
          </p>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={pilotDraft}
              maxLength={120}
              onChange={(e) => setPilotDraft(e.target.value)}
              placeholder={isMn ? 'Ж: Баянзүрх туршилтын баг...' : 'e.g. Bayanzurkh Pilot Unit...'}
              aria-label={isMn ? 'Туршилтын түншийн нэр' : 'Pilot partner name'}
              className="flex-1 min-h-[44px] px-3 rounded-lg border border-slate-200 bg-[#F7F8FA] text-xs text-[#0B124D]"
            />
            <button
              type="button"
              onClick={() => {
                updatePilotPartner(pilotDraft);
                showToast('ok', isMn ? 'Туршилтын түншийн нэр хадгалагдлаа.' : 'Pilot partner label saved locally.');
              }}
              className="min-h-[44px] px-3.5 rounded-lg bg-[#0B124D] hover:bg-[#11166B] text-white text-xs font-bold shrink-0"
            >
              {isMn ? 'Хадгалах' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      {/* Data-Quality Readiness Metrics */}
      <div className="p-3.5 rounded-xl bg-[#F7F8FA] border border-slate-200 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-bold text-[#0B124D]">
            {isMn ? 'Өгөгдлийн чанар ба бэлэн байдал (Data Readiness)' : 'Data-Quality & Pilot Readiness Check'}
          </span>
          <span className="font-mono text-xs font-bold text-[#FF633C]">
            {isMn ? 'Бүрэн байдал' : 'Metadata completeness'}: {qualitySummary.metadataReadinessPct}%
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div className="p-2 rounded-lg bg-white border border-slate-200">
            <span className="text-[#72778A] block">{isMn ? 'Импорт vs Жишээ' : 'Imported vs Demo'}</span>
            <span className="font-mono font-bold text-[#0B124D]">
              {qualitySummary.importedCount} / {qualitySummary.demoBaselineCount}
            </span>
          </div>
          <div className="p-2 rounded-lg bg-white border border-slate-200">
            <span className="text-[#72778A] block">{isMn ? 'Координат алдаатай' : 'Missing/Invalid Coords'}</span>
            <span className={`font-mono font-bold ${qualitySummary.missingCoordsCount > 0 ? 'text-[#E93B2F]' : 'text-emerald-700'}`}>
              {qualitySummary.missingCoordsCount}
            </span>
          </div>
          <div className="p-2 rounded-lg bg-white border border-slate-200">
            <span className="text-[#72778A] block">{isMn ? 'Шалтгаан тодорхойгүй' : 'Unknown Cause'}</span>
            <span className={`font-mono font-bold ${qualitySummary.unknownCauseCount > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
              {qualitySummary.unknownCauseCount}
            </span>
          </div>
          <div className="p-2 rounded-lg bg-white border border-slate-200">
            <span className="text-[#72778A] block">{isMn ? 'Дүүрэг / Хороо сан' : 'Districts / Curated'}</span>
            <span className="font-mono font-bold text-[#0B124D]">
              {qualitySummary.distinctDistrictsCovered}/{qualitySummary.totalDistricts} · {qualitySummary.curatedKhoroos}/{qualitySummary.totalKhoroos}
            </span>
          </div>
        </div>
        <div
          className={`p-2.5 rounded-lg border text-xs flex flex-wrap items-center justify-between gap-2 ${
            mlReadiness.readyForTraining
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-amber-50 border-amber-200 text-amber-950'
          }`}
        >
          <div>
            <span className="font-bold block">
              {isMn ? 'ML сургалтын өгөгдлийн шалгуур (Zero-Demo Gate):' : 'ML Training Gate (Strict Zero-Demo Policy):'}
            </span>
            <span>{isMn ? mlReadiness.readinessReasonMn : mlReadiness.readinessReasonEn}</span>
          </div>
          <span className="font-mono text-xs font-bold px-2 py-1 rounded bg-white/80 border border-current/20 shrink-0">
            REAL: {mlReadiness.cleanUniqueRealCount} · DEMO EXCLUDED: {mlReadiness.excludedDemoCount}
          </span>
        </div>
      </div>

      {/* System Controls Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200">
        <div className="flex items-center gap-2 text-[#0B124D]">
          <Database className="w-4 h-4 text-[#12B89A]" />
          <span className="font-bold">{isMn ? 'SQLite Өгөгдлийн сан идэвхтэй' : 'SQLite Store Connected'}</span>
          {status?.latestWeatherTimestamp && (
            <span className="text-xs font-mono text-[#72778A] hidden sm:inline">
              · {status.latestWeatherTimestamp.slice(0, 16)}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={handleForceWeatherRefresh}
            disabled={busyAction !== null}
            className="px-3 py-2 min-h-[44px] rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-[#0B124D] font-semibold flex items-center gap-1 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busyAction === 'weather' ? 'animate-spin' : ''}`} />
            <span>{isMn ? 'Цаг агаар шинэчлэх' : 'Sync Weather'}</span>
          </button>
          <button
            type="button"
            onClick={handleClearAiCache}
            disabled={busyAction !== null}
            className="px-3 py-2 min-h-[44px] rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-[#0B124D] font-semibold disabled:opacity-50"
          >
            {isMn ? 'AI кэш цэвэрлэх' : 'Clear AI Cache'}
          </button>
          <button
            type="button"
            onClick={() => setShowBatchImport((v) => !v)}
            className={`px-3 py-2 min-h-[44px] rounded-lg font-semibold flex items-center gap-1 transition-colors ${
              showBatchImport
                ? 'bg-[#0B124D] text-white'
                : 'bg-[#FF633C]/10 text-[#C93B17] hover:bg-[#FF633C]/20'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{isMn ? 'CSV / GeoJSON Импорт' : 'CSV / GeoJSON Import'}</span>
          </button>
          <button
            type="button"
            onClick={handleExportJson}
            disabled={incidents.length === 0}
            className="px-3 py-2 min-h-[44px] rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-[#0B124D] font-semibold flex items-center gap-1 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isMn ? 'JSON татах' : 'Export JSON'}</span>
          </button>
          {onLock && (
            <button
              type="button"
              onClick={onLock}
              className="px-3 py-2 min-h-[44px] rounded-lg bg-slate-200/70 hover:bg-slate-200 text-[#0B124D] font-semibold flex items-center gap-1"
              title={isMn ? 'Админ горим түгжих' : 'Lock admin panel'}
            >
              <Lock className="w-3.5 h-3.5" />
              <span>{isMn ? 'Түгжих' : 'Lock'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Real Incident CSV / JSON / GeoJSON Import Drawer */}
      {showBatchImport && (
        <div className="p-4 rounded-xl bg-slate-900 text-slate-100 border border-slate-700 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-mono text-xs uppercase text-emerald-400 block">
                POST /api/v1/incidents/import · ZERO-COERCION & PII GATE
              </span>
              <h4 className="font-bold text-sm text-white">
                {isMn
                  ? 'Бодит гал түймрийн түүхэн өгөгдөл оруулах (CSV / JSON / GeoJSON)'
                  : 'Verified Historical Incident Importer (CSV / JSON / GeoJSON)'}
              </h4>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={handleDownloadCsvTemplate}
                className="px-3 py-2 min-h-[44px] rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 text-xs font-semibold flex items-center gap-1.5"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                <span>{isMn ? 'CSV Загвар татах' : 'Download CSV Template'}</span>
              </button>
              <label className="px-3 py-2 min-h-[44px] rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer border border-slate-600 text-xs font-semibold flex items-center gap-1.5">
                <Upload className="w-3.5 h-3.5" />
                <span>{isMn ? 'Файл сонгох (.csv/.json)' : 'Choose File'}</span>
                <input type="file" accept=".csv,.json,.geojson,text/csv,application/json" onChange={handleFileUpload} className="hidden" />
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="flex items-center gap-1.5 bg-slate-800 p-1 rounded-lg border border-slate-700">
              {(['csv', 'json'] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => {
                    setImportFormat(fmt);
                    setImportPreview(null);
                    setBatchJsonText(fmt === 'csv' ? NEMA_CSV_TEMPLATE : JSON.stringify(SAMPLE_GEOJSON_PAYLOAD, null, 2));
                  }}
                  className={`flex-1 py-2 min-h-[44px] rounded text-xs font-mono font-bold uppercase ${
                    importFormat === fmt ? 'bg-[#FF633C] text-white' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {fmt}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={importSourceName}
              maxLength={48}
              onChange={(e) => setImportSourceName(e.target.value)}
              placeholder="Source (e.g. NEMA-UB)"
              aria-label={isMn ? 'Өгөгдлийн эх сурвалж' : 'Import source name'}
              className="sm:col-span-2 min-h-[44px] px-3 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-100 font-mono"
            />
          </div>

          <p className="text-xs text-slate-300 leading-relaxed">
            {isMn
              ? 'Координат дутуу/буруу (УБ бүсээс гадна), ирээдүйн огноо, буруу хороо болон утас/регистрийн дугаар (PII) бүхий мөрүүдийг хатуу татгалзана (төв рүү шилжүүлж нөхөхгүй). Нэг удаад дээд тал нь 5,000 мөр.'
              : 'Rows missing valid UB coordinates, carrying invalid/future dates, or containing citizen PII (phones, national IDs, emails) are strictly rejected without centroid coercion. Max 5,000 rows per upload.'}
          </p>

          <textarea
            value={batchJsonText}
            onChange={(e) => {
              setBatchJsonText(e.target.value);
              setImportPreview(null);
            }}
            rows={7}
            aria-label={isMn ? 'CSV эсвэл GeoJSON өгөгдөл' : 'Batch CSV or JSON payload'}
            className="w-full rounded-lg bg-slate-950 border border-slate-700 p-2.5 font-mono text-xs text-emerald-300 focus:outline-none focus:ring-2 focus:ring-[#FF633C]"
          />

          {importPreview && (
            <div className="p-3 rounded-lg bg-slate-950 border border-slate-700 space-y-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-white">
                  {importPreview.dryRun
                    ? isMn
                      ? 'Урьдчилсан шалгалтын дүн (Dry Run)'
                      : 'Dry-Run Validation Report'
                    : isMn
                    ? 'Импорт амжилттай хадгалагдлаа'
                    : 'Committed Import Summary'}
                </span>
                <span className="font-mono text-xs text-slate-300">
                  {importPreview.format.toUpperCase()} · {importPreview.totalRows} {isMn ? 'мөр' : 'rows'}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono">
                <div className="p-2 rounded bg-emerald-950/60 border border-emerald-700/50 text-emerald-300">
                  {isMn ? 'Шинэ зөв:' : 'Valid New:'} {importPreview.validNewCount}
                </div>
                <div className="p-2 rounded bg-slate-900 border border-slate-700 text-slate-300">
                  {isMn ? 'Давхардсан:' : 'Duplicates:'} {importPreview.duplicateCount}
                </div>
                <div className="p-2 rounded bg-rose-950/60 border border-rose-700/50 text-rose-300">
                  {isMn ? 'Татгалзсан:' : 'Rejected:'} {importPreview.rejectedCount}
                </div>
                <div className="p-2 rounded bg-amber-950/60 border border-amber-700/50 text-amber-300">
                  PII: {importPreview.piiRejectedCount}
                </div>
              </div>
              {importPreview.rejectedSample.length > 0 && (
                <div className="max-h-28 overflow-y-auto space-y-1 text-xs font-mono text-rose-300 pt-1">
                  {importPreview.rejectedSample.map((rej, idx) => (
                    <div key={`${rej.rowIndex}-${idx}`} className="truncate">
                      Row {rej.rowIndex}: [{rej.reasons.join(', ')}] — {rej.snippet}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => handleStructuredImport(true)}
              disabled={busyAction !== null}
              className="px-3 py-2 min-h-[44px] rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold disabled:opacity-50"
            >
              {busyAction === 'dry-run'
                ? isMn
                  ? 'Шалгаж байна...'
                  : 'Validating...'
                : isMn
                ? 'Урьдчилан шалгах (Dry Run)'
                : 'Dry-Run Validate'}
            </button>
            <button
              type="button"
              onClick={() => handleStructuredImport(false)}
              disabled={busyAction !== null}
              className="px-3.5 py-2 min-h-[44px] rounded-lg bg-[#FF633C] hover:bg-[#e05430] text-white font-bold disabled:opacity-50"
            >
              {busyAction === 'import-commit'
                ? isMn
                  ? 'Хадгалж Open-Meteo холбож байна...'
                  : 'Importing & Syncing Weather...'
                : isMn
                ? 'Импортлох & Цаг агаар холбох'
                : 'Commit Import + Join Weather'}
            </button>
          </div>
        </div>
      )}

      {/* ML Training & Calibration Studio */}
      <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5 mb-0.5">
              <Cpu className="w-4 h-4 text-[#0B124D]" />
              <h4 className="font-bold text-sm text-[#0B124D]">
                {isMn
                  ? 'ML Магадлалын Загвар Сургалт ба Баталгаажуулалт (Calibration Studio)'
                  : 'ML Ignition Probability Training & Validation Studio'}
              </h4>
            </div>
            <p className="text-xs text-[#72778A]">
              {isMn
                ? 'Зөвхөн Open-Meteo Archive түүхэн цаг агаартай холбогдсон бодит бүртгэл дээр сургаж, ROC-AUC ≥ 0.65, Brier < Baseline, ECE ≤ 0.12 давсан үед газрын зургийн % магадлалыг нээнэ.'
                : 'Trained strictly on real incidents joined with Open-Meteo Archive historical weather. Public % ignition probabilities unlock ONLY if temporal holdout passes ROC-AUC >= 0.65, Brier < Baseline, and ECE <= 0.12.'}
            </p>
          </div>
          <span
            className={`px-2 py-1 rounded-lg text-xs font-mono font-bold border shrink-0 ${
              mlStatusPayload?.gatePassed
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}
          >
            {mlStatusPayload?.gatePassed
              ? isMn
                ? 'БАТАЛГААЖСАН (% НЭЭЛТТЭЙ)'
                : 'VALIDATED (% UNLOCKED)'
              : isMn
              ? 'ТҮГЖИГДСЭН (0–100 ИНДЕКС)'
              : 'LOCKED (INDEX ONLY)'}
          </span>
        </div>

        {/* Readiness Progress & Archive Weather Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
          <div className="p-2.5 rounded-lg bg-[#F7F8FA] border border-slate-200">
            <span className="text-[#72778A] block">{isMn ? 'Бодит цэвэр бүртгэл' : 'Verified Real Incidents'}</span>
            <div className="flex items-baseline justify-between mt-0.5">
              <span className="font-mono font-bold text-sm text-[#0B124D]">{mlReadiness.cleanUniqueRealCount} / 200</span>
              <span className="font-mono text-xs text-[#72778A]">
                {mlReadiness.distinctMonths}/12 {isMn ? 'сар' : 'mos'}
              </span>
            </div>
          </div>
          <div className="p-2.5 rounded-lg bg-[#F7F8FA] border border-slate-200">
            <span className="text-[#72778A] block">{isMn ? 'Түүхэн цаг агаарын архив' : 'Archive Weather Days'}</span>
            <span className="font-mono font-bold text-sm text-[#0B124D] block mt-0.5">
              {status?.stats.historicalWeatherCount ?? mlStatusPayload?.stats?.historicalWeatherCount ?? 0}
            </span>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5">
            <button
              type="button"
              onClick={handleSyncHistoricalWeather}
              disabled={busyAction !== null}
              className="flex-1 py-2 px-2.5 min-h-[44px] rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-[#0B124D] font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <CloudRain className={`w-3.5 h-3.5 text-blue-600 ${busyAction === 'hist-weather' ? 'animate-pulse' : ''}`} />
              <span>{isMn ? 'Архив цаг агаар' : 'Sync Archive'}</span>
            </button>
            <button
              type="button"
              onClick={handleTrainMlModel}
              disabled={busyAction !== null}
              className="flex-1 py-2 px-2.5 min-h-[44px] rounded-lg bg-[#0B124D] hover:bg-[#11166B] text-white font-bold flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <BarChart3 className="w-3.5 h-3.5 text-[#FF633C]" />
              <span>{busyAction === 'ml-train' ? (isMn ? 'Сургаж байна...' : 'Training...') : isMn ? 'Загвар сургах' : 'Train & Eval'}</span>
            </button>
          </div>
        </div>

        {/* Latest Model Evaluation Metrics */}
        {mlStatusPayload?.latestModel && (
          <div className="p-3 rounded-xl bg-[#F7F8FA] border border-slate-200 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-mono font-bold text-[#0B124D]">
                {mlStatusPayload.latestModel.modelVersion} · {mlStatusPayload.latestModel.status.toUpperCase()}
              </span>
              <span className="font-mono text-xs text-[#72778A]">
                {isMn ? 'Цаг агаар холбогдсон:' : 'Weather join:'} {mlStatusPayload.latestModel.weatherMatchedPct}% ·{' '}
                {mlStatusPayload.latestModel.trainedAtIso.slice(0, 16)}
              </span>
            </div>

            <div className="space-y-1">
              {(isMn ? mlStatusPayload.latestModel.gateReasonsMn : mlStatusPayload.latestModel.gateReasonsEn).map((r, i) => (
                <div key={i} className="flex items-start gap-1.5 text-xs text-[#0B124D]">
                  {mlStatusPayload.latestModel?.gatePassed ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                  )}
                  <span>{r}</span>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs font-mono">
              <div className="p-2 rounded bg-white border border-slate-200">
                <span className="text-[#72778A] block">ROC-AUC</span>
                <span className="font-bold text-xs text-[#0B124D]">{mlStatusPayload.latestModel.metrics.rocAuc}</span>
                {mlStatusPayload.latestModel.metrics.rocAucCi95 && (
                  <span className="text-[#72778A] block text-xs">
                    95% CI {mlStatusPayload.latestModel.metrics.rocAucCi95[0]}–{mlStatusPayload.latestModel.metrics.rocAucCi95[1]}
                  </span>
                )}
              </div>
              <div className="p-2 rounded bg-white border border-slate-200">
                <span className="text-[#72778A] block">PR-AUC</span>
                <span className="font-bold text-xs text-[#0B124D]">{mlStatusPayload.latestModel.metrics.prAuc}</span>
              </div>
              <div className="p-2 rounded bg-white border border-slate-200">
                <span className="text-[#72778A] block">Brier / Prior / Seas</span>
                <span className="font-bold text-xs text-[#0B124D]">
                  {mlStatusPayload.latestModel.metrics.brierScore} /{' '}
                  {mlStatusPayload.latestModel.metrics.priorRateBrierScore ?? mlStatusPayload.latestModel.metrics.baselineBrierScore} /{' '}
                  {mlStatusPayload.latestModel.metrics.seasonalBrierScore ?? mlStatusPayload.latestModel.metrics.baselineBrierScore}
                </span>
              </div>
              <div className="p-2 rounded bg-white border border-slate-200">
                <span className="text-[#72778A] block">Brier Skill</span>
                <span className="font-bold text-xs text-[#0B124D]">{mlStatusPayload.latestModel.metrics.brierSkillScore}</span>
              </div>
              <div className="p-2 rounded bg-white border border-slate-200">
                <span className="text-[#72778A] block">ECE (5-bin)</span>
                <span className="font-bold text-xs text-[#0B124D]">{mlStatusPayload.latestModel.metrics.ece}</span>
                {mlStatusPayload.latestModel.metrics.eceCi95 && (
                  <span className="text-[#72778A] block text-xs">
                    CI {mlStatusPayload.latestModel.metrics.eceCi95[0]}–{mlStatusPayload.latestModel.metrics.eceCi95[1]}
                  </span>
                )}
              </div>
              <div className="p-2 rounded bg-white border border-slate-200">
                <span className="text-[#72778A] block">Poisson / Ridge RMSE</span>
                <span className="font-bold text-xs text-[#0B124D]">
                  {mlStatusPayload.latestModel.metrics.poissonRmse ?? mlStatusPayload.latestModel.metrics.ridgeRmse} /{' '}
                  {mlStatusPayload.latestModel.metrics.ridgeRmse}
                </span>
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-white border border-slate-200 text-xs text-[#4C5266] space-y-1">
              <div className="font-mono text-[#0B124D] font-semibold">
                {isMn ? '3-шатлалт хугацааны хуваалт:' : 'Strict 3-Way Chronological Split:'}{' '}
                Train ({mlStatusPayload.latestModel.metrics.trainDateRange.join(' → ')}, n={mlStatusPayload.latestModel.metrics.trainSamples}) ·{' '}
                Cal ({(mlStatusPayload.latestModel.metrics.calDateRange ?? ['—', '—']).join(' → ')}, n={mlStatusPayload.latestModel.metrics.calSamples ?? 0}) ·{' '}
                Test ({mlStatusPayload.latestModel.metrics.valDateRange.join(' → ')}, n={mlStatusPayload.latestModel.metrics.valSamples})
              </div>
              {mlStatusPayload.latestModel.metrics.featureProvenance && (
                <div>
                  {isMn
                    ? mlStatusPayload.latestModel.metrics.featureProvenance.noteMn
                    : mlStatusPayload.latestModel.metrics.featureProvenance.noteEn}
                </div>
              )}
            </div>

            {mlStatusPayload.latestModel.metrics.calibrationBins.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-2.5 rounded-lg bg-white border border-slate-200">
                  <span className="text-xs font-mono font-bold text-[#72778A] uppercase block mb-1.5">
                    {isMn ? '5-Бүсийн Калибровк (Таамаг vs Бодит)' : '5-Bin Reliability (Pred vs Observed)'}
                  </span>
                  <div className="space-y-1 font-mono text-xs">
                    {mlStatusPayload.latestModel.metrics.calibrationBins.map((b) => (
                      <div key={b.binIndex} className="flex items-center justify-between text-[#0B124D]">
                        <span>{b.rangeLabel} (n={b.count})</span>
                        <span>
                          {(b.meanPredicted * 100).toFixed(1)}% vs {(b.observedRate * 100).toFixed(1)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="p-2.5 rounded-lg bg-white border border-slate-200">
                  <span className="text-xs font-mono font-bold text-[#72778A] uppercase block mb-1.5">
                    {isMn ? 'Гол нөлөөлөгч шинжүүд' : 'Top Feature Coefficients'}
                  </span>
                  <div className="space-y-1.5 text-xs">
                    {mlStatusPayload.latestModel.metrics.featureImportances.slice(0, 5).map((f) => (
                      <div key={f.feature} className="flex items-center justify-between gap-2">
                        <span className="truncate text-[#0B124D]">{isMn ? f.labelMn : f.labelEn}</span>
                        <span className={`font-mono font-bold shrink-0 ${f.weight >= 0 ? 'text-[#E93B2F]' : 'text-[#12B89A]'}`}>
                          {f.weight >= 0 ? `+${f.weight}` : f.weight}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {batches.length > 0 && (
          <div className="pt-1">
            <span className="text-xs font-mono font-bold text-[#72778A] uppercase block mb-1.5">
              {isMn ? 'Сүүлийн импортын бүртгэлүүд' : 'Recent Ingestion Batches'}
            </span>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[#72778A] font-mono">
                  <tr>
                    <th className="py-1.5 px-2.5">{isMn ? 'Огноо' : 'Time'}</th>
                    <th className="py-1.5 px-2.5">{isMn ? 'Эх сурвалж' : 'Source'}</th>
                    <th className="py-1.5 px-2.5">{isMn ? 'Орсон' : 'Inserted'}</th>
                    <th className="py-1.5 px-2.5">{isMn ? 'Давхар' : 'Dup'}</th>
                    <th className="py-1.5 px-2.5">{isMn ? 'Татгалзсан' : 'Rej/PII'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {batches.slice(0, 5).map((b) => (
                    <tr key={b.id}>
                      <td className="py-1.5 px-2.5 text-[#72778A]">{b.createdAtIso.slice(0, 16)}</td>
                      <td className="py-1.5 px-2.5 text-[#0B124D]">
                        {b.sourceName} ({b.format.toUpperCase()})
                      </td>
                      <td className="py-1.5 px-2.5 text-emerald-700 font-bold">{b.insertedRows}</td>
                      <td className="py-1.5 px-2.5 text-[#72778A]">{b.duplicateRows}</td>
                      <td className="py-1.5 px-2.5 text-[#E93B2F]">
                        {b.rejectedRows} ({b.piiRejectedRows} PII)
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Create / Edit Incident Form */}
      <form onSubmit={handleSaveIncident} className="p-4 rounded-xl bg-white border border-slate-200 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-bold text-sm text-[#0B124D] flex items-center gap-1.5">
            <Plus className="w-4 h-4 text-[#FF633C]" />
            <span>
              {editingId
                ? isMn
                  ? 'Дуудлагын бүртгэл засах'
                  : 'Edit Incident Record'
                : isMn
                ? 'Шинэ дуудлага / бүртгэл нэмэх'
                : 'Add New Incident Record'}
            </span>
          </h4>
          {editingId && (
            <button type="button" onClick={resetForm} className="text-xs text-[#72778A] hover:text-[#0B124D] underline min-h-[44px] px-2">
              {isMn ? 'Засахыг болих' : 'Cancel Edit'}
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5">
          <label className="col-span-1 space-y-1">
            <span className="text-xs font-mono text-[#72778A] block">{isMn ? 'Огноо' : 'Date'}</span>
            <input
              type="date"
              value={formDate}
              onChange={(e) => setFormDate(e.target.value)}
              className="w-full min-h-[44px] px-2 rounded-lg border border-slate-200 bg-[#F7F8FA] text-[#0B124D]"
              required
            />
          </label>
          <label className="col-span-1 sm:col-span-2 space-y-1">
            <span className="text-xs font-mono text-[#72778A] block">{isMn ? 'Дүүрэг' : 'District'}</span>
            <select
              value={formDistrictId}
              onChange={(e) => setFormDistrictId(e.target.value)}
              className="w-full min-h-[44px] px-2 rounded-lg border border-slate-200 bg-[#F7F8FA] text-[#0B124D]"
            >
              {UB_DISTRICTS.map((d) => (
                <option key={d.id} value={d.id}>
                  {isMn ? d.nameMn : d.nameEn}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-1 space-y-1">
            <span className="text-xs font-mono text-[#72778A] block">{isMn ? 'Хороо' : 'Khoroo'}</span>
            <input
              type="number"
              min={1}
              max={60}
              value={formKhorooNumber}
              onChange={(e) => setFormKhorooNumber(Number(e.target.value) || 1)}
              className="w-full min-h-[44px] px-2 rounded-lg border border-slate-200 bg-[#F7F8FA] text-[#0B124D] font-mono"
            />
          </label>
          <label className="col-span-1 space-y-1">
            <span className="text-xs font-mono text-[#72778A] block">{isMn ? 'Ангилал' : 'Category'}</span>
            <select
              value={formCategory}
              onChange={(e) => setFormCategory(e.target.value as IncidentRecord['category'])}
              className="w-full min-h-[44px] px-2 rounded-lg border border-slate-200 bg-[#F7F8FA] text-[#0B124D]"
            >
              <option value="residential_ger">{isMn ? 'Гэр хороолол' : 'Ger settlement'}</option>
              <option value="residential_apt">{isMn ? 'Орон сууц' : 'Apartment'}</option>
              <option value="electrical">{isMn ? 'Цахилгаан' : 'Electrical'}</option>
              <option value="grass_forest">{isMn ? 'Өвс / Ой' : 'Brush / Forest'}</option>
              <option value="commercial">{isMn ? 'Аж ахуй' : 'Commercial'}</option>
            </select>
          </label>
          <label className="col-span-1 space-y-1">
            <span className="text-xs font-mono text-[#72778A] block">{isMn ? 'Ноцтой байдал' : 'Severity'}</span>
            <select
              value={formSeverity}
              onChange={(e) => setFormSeverity(e.target.value as IncidentRecord['severity'])}
              className="w-full min-h-[44px] px-2 rounded-lg border border-slate-200 bg-[#F7F8FA] text-[#0B124D]"
            >
              <option value="minor">{isMn ? 'Хөнгөн' : 'Minor'}</option>
              <option value="moderate">{isMn ? 'Дунд' : 'Moderate'}</option>
              <option value="critical">{isMn ? 'Хүнд' : 'Critical'}</option>
            </select>
          </label>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="text"
            value={formCauseMn}
            onChange={(e) => setFormCauseMn(e.target.value)}
            placeholder={isMn ? 'Жишээ нь: Зуухны яндан хэт халсан, дулаалгын гэмтэл...' : 'Cause / incident description...'}
            className="flex-1 min-h-[44px] px-3 rounded-lg border border-slate-200 bg-[#F7F8FA] text-[#0B124D]"
            required
          />
          <label className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs font-mono text-[#72778A]">{isMn ? 'Гарал:' : 'Origin:'}</span>
            <select
              value={formDataOrigin}
              onChange={(e) => setFormDataOrigin(e.target.value === 'real' ? 'real' : 'demo')}
              aria-label={isMn ? 'Өгөгдлийн гарал' : 'Data origin'}
              className="min-h-[44px] px-2 rounded-lg border border-slate-200 bg-[#F7F8FA] text-[#0B124D] font-mono text-xs"
            >
              <option value="demo">demo</option>
              <option value="real">real</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs font-mono text-[#72778A]">{isMn ? 'Хугацаа (мин):' : 'ETA (min):'}</span>
            <input
              type="number"
              min={1}
              max={240}
              value={formResponseMin}
              onChange={(e) => setFormResponseMin(Number(e.target.value) || 10)}
              className="w-16 min-h-[44px] px-2 rounded-lg border border-slate-200 bg-[#F7F8FA] text-[#0B124D] font-mono"
            />
          </label>
          <button
            type="submit"
            disabled={busyAction !== null}
            className="min-h-[44px] px-4 rounded-lg bg-[#0B124D] hover:bg-[#11166B] text-white font-bold shrink-0 disabled:opacity-50"
          >
            {editingId ? (isMn ? 'Шинэчлэх' : 'Update') : isMn ? 'Хадгалах' : 'Save Record'}
          </button>
        </div>

        {formDataOrigin === 'real' && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 border-t border-slate-100">
            <label className="space-y-1">
              <span className="text-xs font-mono text-[#72778A] block">{isMn ? 'Өргөрөг (Lat)' : 'Latitude (UB)'}</span>
              <input
                type="number"
                step="0.0001"
                min={47.2}
                max={48.35}
                value={formLat}
                onChange={(e) => setFormLat(e.target.value)}
                required
                className="w-full min-h-[44px] px-2 rounded-lg border border-slate-200 bg-[#F7F8FA] text-[#0B124D] font-mono text-xs"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-mono text-[#72778A] block">{isMn ? 'Уртраг (Lng)' : 'Longitude (UB)'}</span>
              <input
                type="number"
                step="0.0001"
                min={106.15}
                max={108.7}
                value={formLng}
                onChange={(e) => setFormLng(e.target.value)}
                required
                className="w-full min-h-[44px] px-2 rounded-lg border border-slate-200 bg-[#F7F8FA] text-[#0B124D] font-mono text-xs"
              />
            </label>
            <div className="col-span-2 flex items-center text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
              {isMn
                ? 'Бодит бүртгэл нь заавал шалгагдсан GPS координаттай байх ёстой (төв рүү автоматаар татахгүй).'
                : 'Verified real records require explicit in-bounds GPS coordinates (no centroid coercion).'}
            </div>
          </div>
        )}
      </form>

      {/* Managed Incidents Table */}
      <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
        <div className="p-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <span className="font-bold text-[#0B124D]">
            {isMn ? `Өгөгдлийн сан дахь бүртгэл (${filteredIncidents.length})` : `Database Incident Records (${filteredIncidents.length})`}
          </span>
          <div className="relative w-56">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#72778A]" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={isMn ? 'Хайх...' : 'Filter records...'}
              className="w-full min-h-[44px] pl-8 pr-2.5 rounded-lg border border-slate-200 bg-[#F7F8FA] text-[#0B124D]"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-6 text-center text-[#72778A] font-mono">
            {isMn ? 'Өгөгдлийн сангаас уншиж байна...' : 'Loading SQLite records...'}
          </div>
        ) : filteredIncidents.length === 0 ? (
          <div className="p-6 text-center text-[#72778A] space-y-2">
            <p>
              {isMn
                ? 'Өгөгдлийн санд нэмэлт дуудлагын бүртгэл хараахан алга байна. Дээрх маягтаар эсвэл GeoJSON импортоор нэмнэ үү.'
                : 'No custom/synced incident records stored yet. Add one above or import GeoJSON.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-[#72778A] font-mono bg-slate-50/70">
                  <th className="py-2 px-3">{isMn ? 'Огноо' : 'Date'}</th>
                  <th className="py-2 px-3">{isMn ? 'Байршил' : 'Location'}</th>
                  <th className="py-2 px-3">{isMn ? 'Тайлбар' : 'Description'}</th>
                  <th className="py-2 px-3">{isMn ? 'Эх үүсвэр' : 'Source'}</th>
                  <th className="py-2 px-3 text-right">{isMn ? 'Үйлдэл' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredIncidents.slice(0, visibleLimit).map((row) => (
                  <ManagedIncidentTableRow
                    key={row.id}
                    row={row}
                    districtLabel={districtName(row.districtId)}
                    isMn={isMn}
                    deleting={busyAction === `del:${row.id}`}
                    onEdit={handleEditStart}
                    onDelete={handleDeleteIncident}
                  />
                ))}
              </tbody>
            </table>
            {filteredIncidents.length > visibleLimit && (
              <div className="p-3 border-t border-slate-100 flex justify-center bg-slate-50/40">
                <button
                  type="button"
                  onClick={() => setVisibleLimit((prev) => prev + 25)}
                  className="px-4 py-2 min-h-[44px] rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-xs font-bold text-[#0B124D]"
                >
                  {isMn
                    ? `Дараагийн 25 мөр харах (${filteredIncidents.length - visibleLimit} үлдсэн)`
                    : `Show 25 more rows (${filteredIncidents.length - visibleLimit} remaining)`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
