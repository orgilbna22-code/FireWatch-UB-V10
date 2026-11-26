import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { IncidentRecord, Language } from '../../types';
import { DEMO_HISTORICAL_INCIDENTS, UB_DISTRICTS } from '../../data/ubGeoData';
import { getTranslation } from '../../i18n/translations';
import { apiAvailability, safeFetchJson } from '../../utils/apiClient';
import { DatasetSourceMode, useFireCommandSettings } from '../../utils/fireCommandSettings';

interface IncidentHistoryProps {
  language: Language;
  onNavigateToMapWithDistrict?: (districtId: string) => void;
  onOpenDemoInfo: () => void;
}

const IncidentTableRow = React.memo<{
  inc: IncidentRecord;
  isMn: boolean;
  isSelected: boolean;
  categoryText: string;
  severityText: string;
  khorooText: string;
  onSelect: (inc: IncidentRecord) => void;
}>(({ inc, isMn, isSelected, categoryText, severityText, khorooText, onSelect }) => (
  <tr
    tabIndex={0}
    aria-selected={isSelected}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(inc);
      }
    }}
    onClick={() => onSelect(inc)}
    className={`hover:bg-[#F7F8FA] cursor-pointer transition-colors ${
      isSelected ? 'bg-orange-50/70 font-semibold' : ''
    }`}
  >
    <td className="py-3 px-3 font-mono text-[#0B124D]">{inc.date}</td>
    <td className="py-3 px-3">
      <span className="font-bold text-[#0B124D]">
        {isMn ? inc.districtNameMn : inc.districtNameEn}
      </span>{' '}
      <span className="text-[#72778A] text-xs">({khorooText})</span>
    </td>
    <td className="py-3 px-3 text-[#72778A]">{categoryText}</td>
    <td className="py-3 px-3">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span
          className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
            inc.severity === 'critical'
              ? 'bg-red-100 text-red-800'
              : inc.severity === 'moderate'
              ? 'bg-orange-100 text-orange-800'
              : 'bg-slate-100 text-slate-700'
          }`}
        >
          {severityText}
        </span>
        <span
          className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded border ${
            inc.isDemo
              ? 'bg-amber-50 text-amber-800 border-amber-200'
              : 'bg-emerald-50 text-emerald-800 border-emerald-200'
          }`}
        >
          {inc.isDemo ? 'DEMO' : 'IMPORTED'}
        </span>
      </div>
    </td>
  </tr>
));

export const IncidentHistory: React.FC<IncidentHistoryProps> = ({
  language,
  onNavigateToMapWithDistrict,
  onOpenDemoInfo,
}) => {
  const t = getTranslation(language);
  const isMn = language === 'mn';
  const [selectedYear, setSelectedYear] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [managedIncidents, setManagedIncidents] = useState<IncidentRecord[]>([]);
  const [syncError, setSyncError] = useState<string | null>(null);
  const { datasetMode, updateDatasetMode } = useFireCommandSettings();
  const [visibleCount, setVisibleCount] = useState<number>(25);
  const [activeIncident, setActiveIncident] = useState<IncidentRecord | null>(
    DEMO_HISTORICAL_INCIDENTS[0]
  );

  useEffect(() => {
    setVisibleCount(25);
  }, [datasetMode, selectedYear, selectedCategory]);

  const loadManaged = useCallback(async () => {
    const result = await safeFetchJson<{
      incidents?: Array<{
        id: string;
        date: string;
        districtId: string;
        khorooNumber?: number;
        khoroo?: number;
        category: IncidentRecord['category'];
        severity: IncidentRecord['severity'];
        causeGuessMn: string;
        causeGuessEn: string;
        responseTimeMin?: number;
        lat: number;
        lng: number;
      }>;
    }>('/api/incidents', {}, language, 8000);

    if (!result.ok) {
      if (result.isApiMissing) {
        apiAvailability.markUnavailable(result.error);
      }
      setSyncError(result.error);
      return;
    }

    setSyncError(null);
    if (Array.isArray(result.data.incidents)) {
      setManagedIncidents(
        result.data.incidents.map((row) => {
          const dist = UB_DISTRICTS.find((d) => d.id === row.districtId);
          return {
            id: row.id,
            date: row.date,
            districtId: row.districtId,
            districtNameMn: dist?.nameMn ?? row.districtId,
            districtNameEn: dist?.nameEn ?? row.districtId,
            khoroo: Number(row.khorooNumber ?? row.khoroo ?? 1),
            category: row.category,
            severity: row.severity,
            causeGuessMn: row.causeGuessMn,
            causeGuessEn: row.causeGuessEn,
            estimatedDamageMnt: 0,
            coordinates: [row.lat, row.lng] as [number, number],
            isDemo: false,
          };
        })
      );
    }
  }, [language]);

  useEffect(() => {
    void loadManaged();
    const onUpdated = () => void loadManaged();
    window.addEventListener('firewatch:incidents-updated', onUpdated);
    return () => {
      window.removeEventListener('firewatch:incidents-updated', onUpdated);
    };
  }, [loadManaged]);

  const combinedIncidents = useMemo(() => {
    if (datasetMode === 'imported') return managedIncidents;
    if (datasetMode === 'demo') return DEMO_HISTORICAL_INCIDENTS;
    return [...managedIncidents, ...DEMO_HISTORICAL_INCIDENTS];
  }, [datasetMode, managedIncidents]);

  const years = ['all', '2026', '2025', '2024', '2023', '2022'];

  const categories = [
    { id: 'all', nameMn: 'Бүх ангилал', nameEn: 'All Categories' },
    { id: 'residential_ger', nameMn: 'Гэр хороолол', nameEn: 'Residential Ger' },
    { id: 'residential_apt', nameMn: 'Орон сууц', nameEn: 'Apartment' },
    { id: 'electrical', nameMn: 'Цахилгаан шугам', nameEn: 'Electrical' },
    { id: 'grass_forest', nameMn: 'Шар өвс / Ой', nameEn: 'Brush & Forest' },
    { id: 'commercial', nameMn: 'Аж ахуйн нэгж', nameEn: 'Commercial' },
  ];

  const filteredIncidents = useMemo(
    () =>
      combinedIncidents.filter((inc) => {
        const matchYear = selectedYear === 'all' || inc.date.startsWith(selectedYear);
        const matchCategory = selectedCategory === 'all' || inc.category === selectedCategory;
        return matchYear && matchCategory;
      }),
    [combinedIncidents, selectedYear, selectedCategory]
  );

  // Keep the detail card meaningful when the active row is filtered away
  const shownIncident =
    activeIncident && filteredIncidents.some((i) => i.id === activeIncident.id)
      ? activeIncident
      : filteredIncidents[0] ?? null;

  const categoryLabel = (cat: IncidentRecord['category']) =>
    cat === 'residential_ger'
      ? (isMn ? 'Гэр хороолол' : 'Ger settlement')
      : cat === 'grass_forest'
        ? (isMn ? 'Шар өвс / Ой' : 'Brush & forest')
        : cat === 'electrical'
          ? (isMn ? 'Цахилгаан' : 'Electrical')
          : cat === 'commercial'
            ? (isMn ? 'Аж ахуйн нэгж' : 'Commercial')
            : (isMn ? 'Орон сууц' : 'Apartment');

  const severityLabel = (sev: IncidentRecord['severity']) =>
    sev === 'critical'
      ? (isMn ? 'ХҮНД' : 'CRITICAL')
      : sev === 'moderate'
        ? (isMn ? 'ДУНД' : 'MODERATE')
        : (isMn ? 'ХӨНГӨН' : 'MINOR');

  const khorooLabel = (n: number) => (isMn ? `${n}-р хороо` : `Khoroo ${n}`);

  return (
    <div className="w-full min-h-[calc(100vh-65px)] bg-[#F7F8FA] p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-[#0B124D]/10">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono font-bold tracking-widest text-[#C93B17] uppercase">
                {language === 'mn' ? 'ТҮҮХЭН ДУУДЛАГЫН ТАНДАЛТ' : 'HISTORICAL INCIDENT DATABASE'}
              </span>
              <button
                onClick={onOpenDemoInfo}
                className="text-xs font-mono bg-amber-50 text-amber-800 border border-amber-200 px-3 py-1.5 rounded min-h-[44px] inline-flex items-center"
              >
                DEMO DATA
              </button>
            </div>
            <h1 className="font-editorial text-2xl sm:text-3xl font-bold text-[#0B124D]">
              {language === 'mn'
                ? 'Галын түүхэн дуудлагын орон зай, цаг хугацааны шинжилгээ'
                : 'Temporal Incident Records & Spatial Concentration Analysis'}
            </h1>
          </div>

          <span className="text-xs font-mono text-[#72778A]">
            {filteredIncidents.length} {language === 'mn' ? 'бүртгэл харуулж байна' : 'records filtered'}
          </span>
        </div>

        {syncError && (
          <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex flex-wrap items-center justify-between gap-2">
            <span>
              {isMn
                ? 'Зөвхөн урьдчилан суулгасан жишээ (DEMO) түүхэн бүртгэл харагдаж байна — серверээс нэмэлт бүртгэл татагдсангүй.'
                : `Showing bundled demo records only (${syncError}).`}
            </span>
            <button
              type="button"
              onClick={() => void loadManaged()}
              className="px-3 py-2 rounded-lg bg-white border border-amber-300 text-xs font-bold text-amber-900 hover:bg-amber-100 min-h-[44px]"
            >
              {isMn ? 'Дахин оролдох' : 'Retry'}
            </button>
          </div>
        )}

        {/* Dataset Source Selector + Timeline & Category Filter Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-[#0B124D]/8 shadow-xs">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={isMn ? 'Өгөгдлийн эх сурвалж' : 'Dataset source'}>
            <span className="text-xs font-mono font-semibold text-[#72778A] mr-1">
              {isMn ? 'Эх сурвалж:' : 'Source:'}
            </span>
            {(
              [
                { id: 'combined', mn: 'Хосолсон', en: 'Combined' },
                { id: 'imported', mn: `Импорт (${managedIncidents.length})`, en: `Imported (${managedIncidents.length})` },
                { id: 'demo', mn: `Жишээ (${DEMO_HISTORICAL_INCIDENTS.length})`, en: `Demo (${DEMO_HISTORICAL_INCIDENTS.length})` },
              ] as Array<{ id: DatasetSourceMode; mn: string; en: string }>
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                aria-pressed={datasetMode === opt.id}
                onClick={() => updateDatasetMode(opt.id)}
                className={`px-3 py-2 rounded-lg text-xs font-mono font-bold transition-colors min-h-[44px] ${
                  datasetMode === opt.id
                    ? 'bg-[#0B124D] text-white'
                    : 'bg-[#F7F8FA] text-[#72778A] hover:text-[#0B124D]'
                }`}
              >
                {isMn ? opt.mn : opt.en}
              </button>
            ))}
          </div>
          
          {/* Year Timeline Buttons */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-mono font-semibold text-[#72778A] mr-2">
              {language === 'mn' ? 'Он:' : 'Year:'}
            </span>
            {years.map((y) => (
              <button
                key={y}
                onClick={() => setSelectedYear(y)}
                className={`px-3 py-2 rounded-lg text-xs font-mono font-bold transition-colors min-h-[44px] ${
                  selectedYear === y
                    ? 'bg-[#0B124D] text-white'
                    : 'bg-[#F7F8FA] text-[#72778A] hover:text-[#0B124D]'
                }`}
              >
                {y === 'all' ? (language === 'mn' ? 'Бүгд' : 'All') : y}
              </button>
            ))}
          </div>

          {/* Category Selector */}
          <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-1 scrollbar-none">
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedCategory(c.id)}
                className={`px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors min-h-[44px] ${
                  selectedCategory === c.id
                    ? 'bg-[#FF633C] text-white'
                    : 'bg-[#F7F8FA] text-[#72778A] hover:text-[#0B124D]'
                }`}
              >
                {language === 'mn' ? c.nameMn : c.nameEn}
              </button>
            ))}
          </div>

        </div>

        {/* Main Content: Incident Table + Detail View Card */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Table (7 cols) */}
          <div className="lg:col-span-7 bg-white p-6 rounded-2xl border border-[#0B124D]/8 shadow-xs">
            <h3 className="font-editorial text-lg font-bold text-[#0B124D] mb-4">
              {language === 'mn' ? 'Бүртгэгдсэн тохиолдлууд' : 'Incident Log Table'}
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-[#72778A] font-mono">
                    <th className="py-2.5 px-3">{language === 'mn' ? 'Огноо' : 'Date'}</th>
                    <th className="py-2.5 px-3">{language === 'mn' ? 'Байршил' : 'Location'}</th>
                    <th className="py-2.5 px-3">{language === 'mn' ? 'Ангилал' : 'Category'}</th>
                    <th className="py-2.5 px-3">{language === 'mn' ? 'Түвшин' : 'Severity'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredIncidents.slice(0, visibleCount).map((inc) => (
                    <IncidentTableRow
                      key={inc.id}
                      inc={inc}
                      isMn={isMn}
                      isSelected={shownIncident?.id === inc.id}
                      categoryText={categoryLabel(inc.category)}
                      severityText={severityLabel(inc.severity)}
                      khorooText={khorooLabel(inc.khoroo)}
                      onSelect={setActiveIncident}
                    />
                  ))}
                  {filteredIncidents.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-[#72778A]">
                        {isMn
                          ? 'Эдгээр шүүлтүүрт тохирох бичлэг олдсонгүй.'
                          : 'No records match these filters.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {filteredIncidents.length > visibleCount && (
              <div className="mt-4 flex justify-center">
                <button
                  type="button"
                  onClick={() => setVisibleCount((prev) => prev + 25)}
                  className="px-4 py-2.5 rounded-xl bg-[#F7F8FA] hover:bg-slate-200/70 border border-black/[0.08] text-xs font-bold text-[#0B124D] transition-colors min-h-[44px]"
                >
                  {isMn
                    ? `Дараагийн 25 бүртгэлийг харах (${filteredIncidents.length - visibleCount} үлдсэн)`
                    : `Show 25 more records (${filteredIncidents.length - visibleCount} remaining)`}
                </button>
              </div>
            )}
          </div>

          {/* Right Selected Incident Detail Card (5 cols) */}
          <div className="lg:col-span-5">
            {shownIncident ? (
              <div className="bg-white p-6 sm:p-8 rounded-2xl border border-[#0B124D]/8 shadow-xs sticky top-20 space-y-6">
                <div>
                  <div className="flex items-center justify-between text-xs font-mono text-[#72778A] mb-1">
                    <span>{shownIncident.id}</span>
                    <span>{shownIncident.date}</span>
                  </div>
                  <h3 className="font-editorial text-2xl font-bold text-[#0B124D]">
                    {language === 'mn' ? shownIncident.districtNameMn : shownIncident.districtNameEn},{' '}
                    {khorooLabel(shownIncident.khoroo)}
                  </h3>
                </div>

                {/* Severity Card */}
                <div className="p-4 rounded-xl bg-[#F7F8FA] border border-[#0B124D]/5">
                  <span className="text-xs font-mono text-[#72778A] uppercase block mb-1">
                    {language === 'mn' ? 'Урьдчилсан шалтгаан & Шинж чанар' : 'Probable Cause Vector'}
                  </span>
                  <p className="text-sm font-semibold text-[#0B124D]">
                    {isMn ? shownIncident.causeGuessMn : shownIncident.causeGuessEn}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-xl bg-[#F7F8FA] border border-[#0B124D]/5">
                    <span className="text-xs text-[#72778A] block">
                      {language === 'mn' ? 'Координат' : 'Coordinates'}
                    </span>
                    <span className="font-mono font-bold text-[#0B124D]">
                      {shownIncident.coordinates[0].toFixed(4)}, {shownIncident.coordinates[1].toFixed(4)}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-[#F7F8FA] border border-[#0B124D]/5">
                    <span className="text-xs text-[#72778A] block">
                      {language === 'mn' ? 'Ойролцоо хохирол' : 'Est. Damage (MNT)'}
                    </span>
                    <span className="font-mono font-bold text-[#C93B17]">
                      ₮{shownIncident.estimatedDamageMnt.toLocaleString()}
                    </span>
                  </div>
                </div>

                {onNavigateToMapWithDistrict && (
                  <button
                    onClick={() => onNavigateToMapWithDistrict(shownIncident.districtId)}
                    className="w-full py-3 bg-[#0B124D] hover:bg-[#11166B] text-white text-xs font-bold rounded-xl transition-colors text-center min-h-[44px]"
                  >
                    {isMn ? 'Энэ дүүргийг газрын зураг дээр шинжлэх' : 'Inspect area on risk map'} →
                  </button>
                )}
              </div>
            ) : (
              <div className="p-8 text-center bg-white rounded-2xl text-[#72778A] text-xs">
                {isMn ? 'Тохиолдол сонгоно уу' : 'Select an incident record to inspect'}
              </div>
            )}
          </div>

        </div>

      </div>
    </div>
  );
};
