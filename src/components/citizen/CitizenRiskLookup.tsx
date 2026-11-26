import React, { useMemo, useState } from 'react';
import { PhoneCall, Share2, Check } from 'lucide-react';
import { ActiveTab, KhorooData, Language, RiskLevel } from '../../types';
import { UB_KHOROOS, UB_DISTRICTS, getKhoroosByDistrict } from '../../data/ubGeoData';
import { SAFETY_GUIDES } from '../../data/safetyData';
import { EMERGENCY_DISPATCH } from '../../data/emergencyContacts';
import { useLiveWeather } from '../../hooks/liveWeather';
import { FeedbackPrompt } from '../common/FeedbackPrompt';

interface CitizenRiskLookupProps {
  language: Language;
  onSelectTab: (tab: ActiveTab) => void;
  onExploreMap?: (districtId?: string) => void;
  externalSelection?: { districtId: string; khorooId: string } | null;
}

const LEVEL_STYLES: Record<
  RiskLevel,
  { mn: string; en: string; badgeClass: string; borderClass: string }
> = {
  low: {
    mn: 'БАГА ЭРСДЭЛ',
    en: 'LOW RISK',
    badgeClass: 'bg-[#12B89A]/15 text-[#0E8771] border-[#12B89A]/40',
    borderClass: 'border-[#12B89A]/40',
  },
  moderate: {
    mn: 'ДУНД ЭРСДЭЛ',
    en: 'MODERATE RISK',
    badgeClass: 'bg-amber-100 text-amber-900 border-amber-300',
    borderClass: 'border-amber-300',
  },
  high: {
    mn: 'ӨНДӨР ЭРСДЭЛ',
    en: 'HIGH RISK',
    badgeClass: 'bg-orange-100 text-[#C2411D] border-[#FF633C]/45',
    borderClass: 'border-[#FF633C]/45',
  },
  very_high: {
    mn: 'МАШ ӨНДӨР ЭРСДЭЛ',
    en: 'VERY HIGH RISK',
    badgeClass: 'bg-red-100 text-[#B91C1C] border-red-300',
    borderClass: 'border-red-300',
  },
};

export const CitizenRiskLookup: React.FC<CitizenRiskLookupProps> = ({
  language,
  onSelectTab,
  onExploreMap,
  externalSelection,
}) => {
  const isMn = language === 'mn';
  const live = useLiveWeather();
  const [selectedDistrictId, setSelectedDistrictId] = useState<string>(
    externalSelection?.districtId ?? UB_DISTRICTS[0]?.id ?? 'bayanzurkh'
  );

  const khoroosInDistrict = useMemo(
    () => getKhoroosByDistrict(selectedDistrictId).slice().sort((a, b) => a.khorooNumber - b.khorooNumber),
    [selectedDistrictId]
  );

  const [selectedKhorooId, setSelectedKhorooId] = useState<string>(
    () =>
      externalSelection?.khorooId ??
      UB_KHOROOS.find((k) => k.districtId === (UB_DISTRICTS[0]?.id ?? 'bayanzurkh'))?.id ??
      ''
  );
  const [shareState, setShareState] = useState<'idle' | 'shared' | 'copied'>('idle');

  React.useEffect(() => {
    if (externalSelection?.districtId) {
      setSelectedDistrictId(externalSelection.districtId);
      setSelectedKhorooId(externalSelection.khorooId);
    }
  }, [externalSelection?.districtId, externalSelection?.khorooId]);

  const district = useMemo(
    () => UB_DISTRICTS.find((d) => d.id === selectedDistrictId) ?? UB_DISTRICTS[0],
    [selectedDistrictId]
  );

  const khoroo: KhorooData | undefined = useMemo(
    () => khoroosInDistrict.find((k) => k.id === selectedKhorooId) ?? khoroosInDistrict[0],
    [khoroosInDistrict, selectedKhorooId]
  );

  const handleDistrictChange = (nextDistId: string) => {
    setSelectedDistrictId(nextDistId);
    const firstKhoroo = getKhoroosByDistrict(nextDistId)
      .slice()
      .sort((a, b) => a.khorooNumber - b.khorooNumber)[0];
    setSelectedKhorooId(firstKhoroo?.id ?? '');
  };

  const score = khoroo ? khoroo.riskScore : district.riskScore;
  const riskLevel = khoroo ? khoroo.riskLevel : district.riskLevel;
  const isModelled = khoroo ? Boolean(khoroo.isModelled) : Boolean(district.isModelled);
  const levelInfo = LEVEL_STYLES[riskLevel];

  // Top 2 plain-language reasons derived strictly from district factor weights & khoroo attributes
  const topReasons = useMemo(() => {
    const reasons: string[] = [];
    if (khoroo) {
      reasons.push(isMn ? khoroo.primaryRiskFactorMn : khoroo.primaryRiskFactorEn);
    }
    const sortedContribs = [...district.contributions].sort(
      (a, b) => b.contributionValue - a.contributionValue
    );
    for (const c of sortedContribs) {
      if (reasons.length >= 2) break;
      const text = isMn
        ? `${c.nameMn} (${Math.round(c.contributionValue)} оноо нөлөө)`
        : `${c.nameEn} (${Math.round(c.contributionValue)} weighted pts)`;
      if (!reasons.includes(text)) reasons.push(text);
    }
    return reasons.slice(0, 2);
  }, [khoroo, district, isMn]);

  // 3 tailored prevention steps pulled strictly from safetyData.ts guides
  const threeSteps = useMemo(() => {
    const gerPct = khoroo ? khoroo.gerHouseholdPercent : district.gerHouseholdPercent;
    const guideId =
      gerPct >= 50
        ? 'guide-ger'
        : live.windSpeedKmh >= 20
        ? 'guide-spring'
        : 'guide-apartments';
    const guide = SAFETY_GUIDES.find((g) => g.id === guideId) ?? SAFETY_GUIDES[0];
    return guide.keySteps.slice(0, 3);
  }, [khoroo, district, live.windSpeedKmh]);

  const weatherTimeLabel = live.observedAtIso
    ? live.observedAtIso.replace('T', ' ').slice(0, 16)
    : isMn
    ? 'Офлайн / кэш мэдээ'
    : 'Offline / cached';

  const handleShare = async () => {
    const areaTitle = khoroo
      ? isMn
        ? `${district.nameMn}, ${khoroo.khorooNumber}-р хороо`
        : `${district.nameEn}, Khoroo ${khoroo.khorooNumber}`
      : isMn
      ? district.nameMn
      : district.nameEn;

    const text = isMn
      ? `FIREWATCH UB — ${areaTitle}: галын эрсдэлийн индекс ${score}/100 (${levelInfo.mn}). Дэлгэрэнгүй: ${window.location.href}`
      : `FIREWATCH UB — ${areaTitle}: fire risk index ${score}/100 (${levelInfo.en}). View: ${window.location.href}`;

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'FIREWATCH UB', text, url: window.location.href });
        setShareState('shared');
        window.setTimeout(() => setShareState('idle'), 2200);
        return;
      } catch {
        // Fallback cleanly to clipboard below if user cancelled or unsupported
      }
    }

    try {
      await navigator.clipboard.writeText(text);
      setShareState('copied');
      window.setTimeout(() => setShareState('idle'), 2200);
    } catch {
      setShareState('idle');
    }
  };

  return (
    <section
      aria-labelledby="citizen-quick-lookup-heading"
      className="mb-8 rounded-3xl border border-[#0B124D]/12 bg-[#F7F8FA] p-4 sm:p-6 space-y-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#C93B17] block">
            {isMn ? 'ИРГЭНИЙ ХУРДАН ШАЛГАЛТ' : 'CITIZEN QUICK RISK CHECK'}
          </span>
          <h3 id="citizen-quick-lookup-heading" className="font-editorial text-xl sm:text-2xl font-bold text-[#0B124D]">
            {isMn ? 'Миний хороо өнөөдөр эрсдэлтэй юу?' : 'What is my khoroo risk index today?'}
          </h3>
        </div>
        <button
          type="button"
          onClick={() => onSelectTab('personal')}
          className="min-h-[44px] px-3 py-2 text-xs font-bold text-[#0B124D] hover:text-[#C93B17] underline transition-colors"
        >
          {isMn ? 'Миний гэр →' : 'My Home Audit →'}
        </button>
      </div>

      {/* District & Khoroo Pickers */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="citizen-district-select"
            className="block text-xs font-mono font-bold uppercase text-[#5C6275] mb-1"
          >
            {isMn ? 'Дүүрэг сонгох' : 'Select District'}
          </label>
          <select
            id="citizen-district-select"
            value={selectedDistrictId}
            onChange={(e) => handleDistrictChange(e.target.value)}
            className="w-full min-h-[44px] rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold text-[#0B124D]"
          >
            {UB_DISTRICTS.map((d) => (
              <option key={d.id} value={d.id}>
                {isMn ? d.nameMn : d.nameEn}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="citizen-khoroo-select"
            className="block text-xs font-mono font-bold uppercase text-[#5C6275] mb-1"
          >
            {isMn ? 'Хороо сонгох' : 'Select Khoroo'}
          </label>
          <select
            id="citizen-khoroo-select"
            value={khoroo?.id ?? ''}
            onChange={(e) => setSelectedKhorooId(e.target.value)}
            className="w-full min-h-[44px] rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold text-[#0B124D]"
          >
            {khoroosInDistrict.map((k) => (
              <option key={k.id} value={k.id}>
                {isMn ? `${k.khorooNumber}-р хороо` : `Khoroo ${k.khorooNumber}`}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Single Summary Risk Card */}
      <div className={`rounded-2xl bg-white border ${levelInfo.borderClass} p-4 sm:p-5 space-y-4 shadow-2xs`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className={`px-2.5 py-0.5 rounded-full border text-xs font-mono font-bold ${levelInfo.badgeClass}`}>
                {isMn ? levelInfo.mn : levelInfo.en}
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-[#4B5563] text-xs font-mono font-bold">
                {isModelled ? (isMn ? 'Загварчилсан' : 'Modelled') : isMn ? 'Жишээ суурь' : 'Demo baseline'}
              </span>
            </div>
            <div className="font-editorial text-xl sm:text-2xl font-bold text-[#0B124D]">
              {isMn ? 'эрсдэлийн индекс' : 'risk index'}{' '}
              <span className="font-mono text-[#C93B17] tabular-nums">{score}/100</span>
            </div>
          </div>

          <div className="text-right font-mono text-xs text-[#5C6275]">
            <div>
              {live.symbol} {live.tempCelsius}°C · {isMn ? 'Салхи' : 'Wind'} {live.windSpeedKmh} km/h
            </div>
            <div className="text-xs">
              {isMn ? 'Цаг агаар:' : 'Meteo:'} {weatherTimeLabel}
            </div>
          </div>
        </div>

        {/* Top 2 plain reasons */}
        <div className="space-y-1.5 pt-2 border-t border-black/[0.06]">
          <div className="text-xs font-mono font-bold uppercase text-[#5C6275]">
            {isMn ? 'Гол 2 шалтгаан' : 'Top 2 contributing factors'}
          </div>
          <ul className="space-y-1 text-sm text-[#12152A]">
            {topReasons.map((reason, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="font-mono font-bold text-[#C93B17]">{idx + 1}.</span>
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* "Юу хийх вэ" — 3 steps from safetyData.ts */}
        <div className="space-y-2 pt-2 border-t border-black/[0.06]">
          <div className="text-xs font-mono font-bold uppercase text-[#0B124D]">
            {isMn ? 'Юу хийх вэ? (Гэрийн 3 алхам)' : 'What to do (3 practical steps)'}
          </div>
          <ol className="space-y-2 text-sm text-[#12152A]">
            {threeSteps.map((step) => (
              <li key={step.step} className="flex items-start gap-2.5 bg-[#F7F8FA] rounded-xl px-3 py-2.5">
                <span className="w-6 h-6 rounded-full bg-[#0B124D] text-white text-xs font-mono font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {step.step}
                </span>
                <div>
                  <span className="font-bold text-[#0B124D]">{isMn ? step.actionMn : step.actionEn}</span>
                  <span className="block text-xs text-[#5C6275] mt-0.5">
                    {isMn ? step.detailsMn : step.detailsEn}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* Persistent Call 105 + Share + Map CTA + Disclaimer */}
        <div className="pt-3 border-t border-black/[0.06] flex flex-wrap items-center gap-2.5">
          <a
            href={`tel:${EMERGENCY_DISPATCH.rescue}`}
            className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2.5 rounded-xl bg-[#E93B2F] hover:bg-[#c82d22] text-white text-xs font-bold shadow-sm transition-colors"
          >
            <PhoneCall className="w-4 h-4" aria-hidden="true" />
            <span>{isMn ? `${EMERGENCY_DISPATCH.rescue} руу залгах` : `Call ${EMERGENCY_DISPATCH.rescue}`}</span>
          </a>

          <button
            type="button"
            onClick={() => void handleShare()}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-4 py-2.5 rounded-xl bg-[#0B124D]/8 hover:bg-[#0B124D]/15 text-[#0B124D] text-xs font-bold transition-colors"
          >
            {shareState !== 'idle' ? (
              <Check className="w-4 h-4 text-[#12B89A]" aria-hidden="true" />
            ) : (
              <Share2 className="w-4 h-4" aria-hidden="true" />
            )}
            <span>
              {shareState === 'copied'
                ? isMn
                  ? 'Хуулагдлаа'
                  : 'Copied'
                : shareState === 'shared'
                ? isMn
                  ? 'Хуваалцлаа'
                  : 'Shared'
                : isMn
                ? 'Хуваалцах'
                : 'Share'}
            </span>
          </button>

          {onExploreMap && (
            <button
              type="button"
              onClick={() => onExploreMap(district.id)}
              className="inline-flex items-center gap-1 min-h-[44px] px-4 py-2.5 rounded-xl bg-[#0B124D] hover:bg-[#11166B] text-white text-xs font-bold transition-colors"
            >
              <span>{isMn ? 'Газрын зураг дээр харах →' : 'View on map →'}</span>
            </button>
          )}
        </div>

        <p className="text-xs text-[#5C6275] leading-relaxed">
          ⚠️{' '}
          {isMn
            ? 'Энэхүү индекс (0–100) нь мэдээллийн зорилготой бөгөөд гал гарах магадлал (%) биш. Онцгой байдлын албан ёсны зарлан мэдээллийг орлохгүй.'
            : 'Informational 0–100 index only — not an ignition probability % and not an official emergency dispatch alert.'}
        </p>

        <FeedbackPrompt
          language={language}
          contextArea={
            khoroo
              ? isMn
                ? `${district.nameMn}, ${khoroo.khorooNumber}-р хороо`
                : `${district.nameEn}, Khoroo ${khoroo.khorooNumber}`
              : isMn
              ? district.nameMn
              : district.nameEn
          }
          contextTimestamp={weatherTimeLabel}
        />
      </div>
    </section>
  );
};
