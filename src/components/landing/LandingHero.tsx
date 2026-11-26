import React, { Suspense, lazy, useMemo, useState } from 'react';
import { ActiveTab, Language, RiskLevel } from '../../types';
import { getTranslation } from '../../i18n/translations';
import { MONTH_RISK_CALENDAR, TOTAL_HISTORICAL_INCIDENTS, UB_DISTRICTS } from '../../data/ubGeoData';
import { useLiveWeather } from '../../hooks/liveWeather';
import { FireAnimation } from '../common/FireAnimation';
import { CitizenRiskLookup } from '../citizen/CitizenRiskLookup';
import { AUDIENCE_PROFILES, AudienceRole } from '../../utils/audienceSession';
import { getUbMonthIndex } from '../../utils/ubTime';
import { shouldReduceMotionOrData } from '../../utils/motionBudget';

const AmbientFireBackground = lazy(() =>
  import('../common/AmbientFireBackground').then((m) => ({ default: m.AmbientFireBackground }))
);

interface LandingHeroProps {
  language: Language;
  audience: AudienceRole;
  onSelectAudience: (role: AudienceRole) => void;
  onExploreMap: () => void;
  onSelectTab: (tab: ActiveTab) => void;
  onOpenDemoInfo: () => void;
  onOpenFamilyMode?: () => void;
}

export const LandingHero: React.FC<LandingHeroProps> = ({
  language,
  audience,
  onSelectAudience,
  onExploreMap,
  onSelectTab,
  onOpenDemoInfo,
  onOpenFamilyMode,
}) => {
  const t = getTranslation(language);
  const isMn = language === 'mn';
  const currentProfile = AUDIENCE_PROFILES[audience];
  const live = useLiveWeather();
  const [activeSolutionIdx, setActiveSolutionIdx] = useState<number>(0);
  const [phoneMonthIdx, setPhoneMonthIdx] = useState<number>(() => getUbMonthIndex());
  const lowPowerMode = shouldReduceMotionOrData();

  const topWatchDistricts = useMemo(
    () => [...UB_DISTRICTS].sort((a, b) => b.riskScore - a.riskScore).slice(0, 3),
    []
  );

  const solutions = [
    {
      num: '01',
      title: t.solution1Title,
      desc: t.solution1Desc,
      tag: language === 'mn' ? 'Хяналт & Тандалт' : 'Surveillance',
      tabTarget: 'map' as ActiveTab,
      icon: '🗺️',
    },
    {
      num: '02',
      title: t.solution2Title,
      desc: t.solution2Desc,
      tag: language === 'mn' ? 'Олон хүчин зүйл' : 'Multi-Factor',
      tabTarget: 'explorer' as ActiveTab,
      icon: '📊',
    },
    {
      num: '03',
      title: t.solution3Title,
      desc: t.solution3Desc,
      tag: language === 'mn' ? 'Бүс нутаг' : 'Zonal Action',
      tabTarget: 'districts' as ActiveTab,
      icon: '🏙️',
    },
    {
      num: '04',
      title: t.solution4Title,
      desc: t.solution4Desc,
      tag: language === 'mn' ? 'Олон нийт' : 'Civil Safety',
      tabTarget: 'safety' as ActiveTab,
      icon: '🛡️',
    },
  ];

  const selectedMonth = MONTH_RISK_CALENDAR[phoneMonthIdx];

  const WEEK_LEVEL_TEXT: Record<RiskLevel, { mn: string; en: string }> = {
    low: { mn: 'БАГА ЭРСДЭЛ', en: 'LOW RISK' },
    moderate: { mn: 'ДУНД ЭРСДЭЛ', en: 'MODERATE' },
    high: { mn: 'ӨНДӨР ЭРСДЭЛ', en: 'HIGH RISK' },
    very_high: { mn: 'МАШ ӨНДӨР', en: 'VERY HIGH' },
  };

  // The phone mock-up badge must not stay red when a month is genuinely calm.
  const weekTone =
    selectedMonth.riskLevel === 'high' || selectedMonth.riskLevel === 'very_high'
      ? { box: 'bg-red-50 border-red-100', note: 'text-red-600', strong: 'text-[#E93B2F]' }
      : selectedMonth.riskLevel === 'moderate'
      ? { box: 'bg-amber-50 border-amber-100', note: 'text-amber-700', strong: 'text-[#C2740B]' }
      : { box: 'bg-emerald-50 border-emerald-100', note: 'text-emerald-700', strong: 'text-[#0E9F86]' };
  const weekText = WEEK_LEVEL_TEXT[selectedMonth.riskLevel] ?? WEEK_LEVEL_TEXT.moderate;

  return (
    <div className="w-full bg-transparent">
      <div className="max-w-[1440px] mx-auto px-3 sm:px-6 pt-3 sm:pt-5 pb-6 grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 items-start">
        
        {/* ========================================================= */}
        {/* LEFT COLUMN: Deep Navy Sculpted Card + Telemetry Stack    */}
        {/* ========================================================= */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          <div
            className="text-white p-5 sm:p-7 flex flex-col justify-between relative overflow-hidden rounded-[28px] sm:rounded-[36px] border border-white/15 shadow-[0_24px_64px_-16px_rgba(11,18,77,0.48)]"
            style={{
              background: 'linear-gradient(155deg, #0B124D 0%, #0E175A 52%, #191642 100%)',
            }}
          >
            {/* Ambient Living Fire Thermal Background (lazy-loaded & skipped under low-data / reduced-motion) */}
            {!lowPowerMode && (
              <Suspense fallback={null}>
                <AmbientFireBackground intensity={1.15} />
              </Suspense>
            )}

            {/* Feathered radial dot pattern (softly fades before card edges) */}
            <div
              className="absolute inset-0 opacity-[0.045] pointer-events-none"
              style={{
                backgroundImage: `radial-gradient(#FFFFFF 1px, transparent 1px)`,
                backgroundSize: '24px 24px',
                maskImage: 'radial-gradient(ellipse at 50% 45%, black 42%, transparent 88%)',
                WebkitMaskImage: 'radial-gradient(ellipse at 50% 45%, black 42%, transparent 88%)',
              }}
            />

            {/* Top Location Indicator (jargon-free) */}
            <div className="flex items-center justify-between text-xs tracking-wider text-white/70 font-mono z-10">
              <span className="uppercase font-semibold tracking-widest text-[#FF633C] flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#FF633C] animate-pulse" />
                {isMn ? 'УЛААНБААТАР · МОНГОЛ' : 'ULAANBAATAR · MONGOLIA'}
              </span>
            </div>

            {/* Core Brand & Compact Interactive Fire Emblem */}
            <div className="my-4 z-10">
              <div className="w-28 h-32 sm:w-36 sm:h-40 rounded-[24px] sm:rounded-[28px] bg-gradient-to-b from-white/12 to-white/5 backdrop-blur-2xl border border-white/20 flex flex-col items-center justify-center p-2.5 mb-4 shadow-[0_16px_50px_rgba(255,99,60,0.28)] relative group transition-all duration-300 mx-auto sm:mx-0">
                <FireAnimation
                  size="md"
                  intensity="high"
                  interactive={true}
                  className="my-auto"
                />
                <div className="absolute inset-0 bg-radial from-[#FF633C]/25 via-transparent to-transparent rounded-[24px] sm:rounded-[28px] -z-10 group-hover:from-[#FF633C]/45 transition-colors pointer-events-none" />
              </div>

              {/* Giant Title with Apple-grade tight tracking */}
              <h1 className="font-editorial text-3xl sm:text-5xl font-bold tracking-tight text-white leading-[1.05] mb-3 text-balance">
                FIREWATCH<br />
                <span className="text-[#FF633C] font-mono text-2xl sm:text-3xl font-semibold">UB</span>
              </h1>

              {/* Editorial Tagline */}
              <p className="font-editorial text-lg sm:text-xl text-white/90 leading-snug font-normal mb-4 italic text-balance">
                “{t.tagline}”
              </p>

              {/* Direction Pill */}
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 text-white/80 text-xs font-mono tracking-wide mb-4 border border-white/10 backdrop-blur-md max-w-full">
                <span className="w-1.5 h-1.5 rounded-full bg-[#12B89A] shrink-0" />
                <span className="truncate">{t.directionPill}</span>
              </div>

              {/* Large Statistic Treatment */}
              <div className="pt-4 border-t border-white/10">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-4xl sm:text-5xl font-bold tracking-tight text-white tabular-nums">
                    {TOTAL_HISTORICAL_INCIDENTS.toLocaleString()}
                  </span>
                  <span className="text-xs font-mono text-[#FF633C] uppercase tracking-wider font-semibold">
                    {isMn ? 'жишээ бичлэг' : 'demo records'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <p className="text-xs text-white/70">
                    {isMn
                      ? 'Жишээ шинжилгээнд хамруулсан орон зайн өгөгдөл'
                      : 'Illustrative baseline spatial records modeled'}
                  </p>
                  <button
                    onClick={onOpenDemoInfo}
                    className="text-xs font-mono bg-white/15 hover:bg-white/25 text-white/90 px-2 py-0.5 rounded-full transition-colors whitespace-nowrap"
                  >
                    {t.demoMode.split('·')[0].trim()}
                  </button>
                </div>
              </div>
            </div>

            {/* Bottom Left Quick Meta */}
            <div className="z-10 mt-2 px-4 py-2.5 rounded-2xl bg-white/[0.06] border border-white/10 backdrop-blur-md flex flex-wrap items-center justify-between gap-2 text-xs text-white/75 font-mono">
              <span>Open-Meteo · 47.92°N</span>
              <span className="flex items-center gap-1.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    live.status === 'live'
                      ? 'bg-[#12B89A] animate-pulse'
                      : live.status === 'stale'
                      ? 'bg-amber-400'
                      : 'bg-slate-400'
                  }`}
                />
                {live.status === 'live'
                  ? 'LIVE METEO'
                  : live.status === 'stale'
                  ? isMn
                    ? 'КЭШ ЦАГ АГААР'
                    : 'CACHED METEO'
                  : live.status === 'loading'
                  ? isMn
                    ? 'ХОЛБОГДОЖ БАЙНА'
                    : 'CONNECTING'
                  : isMn
                  ? 'ЦАГ АГААР ТАСАРСАН'
                  : 'METEO OFFLINE'}
              </span>
            </div>
          </div>

          {/* Card 1 below LIVE METEO: Live Fire-Weather Breakdown (Open-Meteo real telemetry) */}
          <section
            aria-label={isMn ? 'Бодит цаг агаарын галын нөхцөл' : 'Live fire-weather conditions'}
            className="bg-white rounded-[24px] border border-black/10 dark:border-white/10 shadow-[0_18px_42px_-12px_rgba(6,10,36,0.35)] p-4 sm:p-5 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-lg shrink-0" aria-hidden="true">{live.symbol}</span>
                <div className="min-w-0">
                  <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-[#0B124D] truncate">
                    {isMn ? 'УБ Бодит цаг агаарын нөхцөл' : 'Live UB Fire-Weather'}
                  </h3>
                  <p className="text-xs text-[#72778A] truncate">
                    {live.isLive
                      ? `Open-Meteo · ${live.lastUpdated}`
                      : live.status === 'stale'
                      ? isMn
                        ? `Кэш ажиглалт · ${live.lastUpdated}`
                        : `Cached · ${live.lastUpdated}`
                      : isMn
                      ? 'Улирлын суурь утга (Оффлайн)'
                      : 'Seasonal baseline (Offline)'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onSelectTab('weather')}
                className="text-xs font-bold text-[#FF633C] hover:underline shrink-0"
              >
                {isMn ? 'Дэлгэрэнгүй →' : 'Weather →'}
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2.5 rounded-2xl bg-[#F7F8FA] border border-black/[0.04]">
                <div className="text-xs text-[#72778A] font-medium">
                  {isMn ? 'Температур' : 'Temp'}
                </div>
                <div className="font-mono text-base font-bold text-[#0B124D] tabular-nums mt-0.5">
                  {live.tempCelsius}°C
                </div>
              </div>
              <div className="p-2.5 rounded-2xl bg-[#F7F8FA] border border-black/[0.04]">
                <div className="text-xs text-[#72778A] font-medium">
                  {isMn ? 'Чийгшил' : 'Humidity'}
                </div>
                <div className="font-mono text-base font-bold text-[#0B124D] tabular-nums mt-0.5">
                  {live.humidityPercent}%
                </div>
              </div>
              <div className="p-2.5 rounded-2xl bg-[#F7F8FA] border border-black/[0.04]">
                <div className="text-xs text-[#72778A] font-medium">
                  {isMn ? 'Салхи' : 'Wind'}
                </div>
                <div className="font-mono text-base font-bold text-[#0B124D] tabular-nums mt-0.5">
                  {live.windSpeedKmh} <span className="text-xs font-normal">{isMn ? 'км/ц' : 'km/h'}</span>
                </div>
              </div>
            </div>

            {/* Separated physics bars: Ignition vs Spread */}
            <div className="grid grid-cols-2 gap-2.5 pt-1 text-xs">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[#5C6275] font-medium">
                    {isMn ? 'Авалцах нөхцөл' : 'Ignition index'}
                  </span>
                  <span className="font-mono font-bold text-[#0B124D] tabular-nums">
                    {live.ignitionReceptivity}/100
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#FF633C] transition-all"
                    style={{ width: `${live.ignitionReceptivity}%` }}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[#5C6275] font-medium">
                    {isMn ? 'Тархах боломж' : 'Spread wind'}
                  </span>
                  <span className="font-mono font-bold text-[#0B124D] tabular-nums">
                    {live.spreadPotential}/100
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#0B124D] transition-all"
                    style={{ width: `${live.spreadPotential}%` }}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Card 2: Top Priority Demo Districts Quick Watchlist */}
          <section
            aria-label={isMn ? 'Жишээ загварын тэргүүлэх бүсүүд' : 'Top priority demo zones'}
            className="bg-white rounded-[24px] border border-black/[0.06] shadow-xs p-4 sm:p-5 space-y-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#0B124D] truncate">
                  {isMn ? 'Анхаарлын тэргүүн дүүргүүд' : 'Priority Watch Districts'}
                </span>
                <span className="text-xs font-mono font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 shrink-0">
                  DEMO
                </span>
              </div>
              <button
                type="button"
                onClick={onExploreMap}
                className="text-xs font-bold text-[#0B124D] hover:text-[#FF633C] shrink-0"
              >
                {isMn ? 'Бүгдийг газрын зургаар →' : 'Map view →'}
              </button>
            </div>

            <div className="space-y-1.5">
              {topWatchDistricts.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={onExploreMap}
                  className="w-full px-3 py-2 rounded-xl bg-[#F7F8FA] hover:bg-orange-50/70 border border-black/[0.04] hover:border-[#FF633C]/40 transition-all flex items-center justify-between gap-2 text-left group"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-[#0B124D] group-hover:text-[#FF633C] truncate">
                      {isMn ? `${d.nameMn} дүүрэг` : `${d.nameEn} District`}
                    </div>
                    <div className="text-xs text-[#72778A] truncate">
                      {isMn
                        ? `Гэр хороолол ${d.gerHouseholdPercent}% · Анги ~${d.nearestStationDistKm} км`
                        : `Ger share ${d.gerHouseholdPercent}% · Unit ~${d.nearestStationDistKm} km`}
                    </div>
                  </div>
                  <span
                    className={`font-mono text-xs font-bold px-2 py-0.5 rounded-lg shrink-0 ${
                      d.riskScore >= 75
                        ? 'bg-red-100 text-[#E93B2F]'
                        : 'bg-orange-100 text-[#FF633C]'
                    }`}
                  >
                    {d.riskScore}/100
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* Card 3: Quick Emergency Dial & Safety Shortcut */}
          <div className="rounded-[22px] bg-[#0B124D] text-white p-4 flex items-center justify-between gap-3 shadow-xs">
            <div className="min-w-0">
              <div className="text-xs font-mono uppercase tracking-widest text-[#FF633C] font-bold">
                {isMn ? 'ШУУРХАЙ ДУУДЛАГА · 24/7' : 'EMERGENCY DISPATCH · 24/7'}
              </div>
              <p className="text-xs text-white/85 mt-0.5 truncate">
                {isMn
                  ? 'Гал гарсан тохиолдолд шууд залгана уу'
                  : 'Call emergency services immediately on smoke or fire'}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <a
                href="tel:101"
                className="px-3 py-2 rounded-xl bg-[#E93B2F] hover:bg-red-600 text-white font-mono text-xs font-extrabold transition-colors"
              >
                ☎ 101
              </a>
              <a
                href="tel:105"
                className="px-2.5 py-2 rounded-xl bg-white/12 hover:bg-white/20 text-white font-mono text-xs font-bold transition-colors"
              >
                105
              </a>
            </div>
          </div>
        </div>

        {/* ========================================================= */}
        {/* RIGHT PANEL: White Storytelling & Interactive Mockup      */}
        {/* ========================================================= */}
        <div className="lg:col-span-7 bg-[#FFFFFF] rounded-[28px] sm:rounded-[36px] border border-black/10 dark:border-white/10 shadow-[0_24px_60px_-15px_rgba(6,10,36,0.42)] p-5 sm:p-8 lg:p-9 flex flex-col justify-between overflow-hidden">
          <div>
            {/* "Who are you?" Audience Selector — Primary Entry */}
            <section aria-labelledby="who-are-you-heading" className="mb-8">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div>
                  <span className="text-xs font-mono font-bold tracking-widest text-[#FF633C] uppercase block">
                    {isMn ? 'ТА ХЭН БЭ? · ЗОРИУЛАЛТАА СОНГОХ' : 'WHO ARE YOU? · CHOOSE YOUR VIEW'}
                  </span>
                  <h2 id="who-are-you-heading" className="font-editorial text-2xl sm:text-3xl font-bold text-[#0B124D] leading-snug">
                    {isMn ? 'Өөрт тохирсон хэсгээр эхлээрэй' : 'Start with what you need right now'}
                  </h2>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                {(['citizen', 'fire_command', 'police'] as AudienceRole[]).map((roleId) => {
                  const prof = AUDIENCE_PROFILES[roleId];
                  const selected = audience === roleId;
                  return (
                    <button
                      key={roleId}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onSelectAudience(roleId)}
                      className={`p-4 rounded-2xl border text-left transition-all flex flex-col justify-between gap-2 ${
                        selected
                          ? 'bg-[#0B124D] text-white border-[#0B124D] shadow-md ring-2 ring-[#FF633C]'
                          : 'bg-[#F7F8FA] text-[#0B124D] border-black/[0.08] hover:border-[#0B124D]/30 hover:bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-2xl" aria-hidden="true">{prof.icon}</span>
                        {selected && (
                          <span className="text-xs font-mono font-bold uppercase px-2 py-0.5 rounded-full bg-[#FF633C] text-white">
                            {isMn ? 'Сонгосон' : 'Active'}
                          </span>
                        )}
                      </div>
                      <div>
                        <div className="font-bold text-sm">{isMn ? prof.labelMn : prof.labelEn}</div>
                        <p className={`text-xs mt-1 leading-snug ${selected ? 'text-white/80' : 'text-[#5C6275]'}`}>
                          {isMn ? prof.promiseMn : prof.promiseEn}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Single Audience Primary Call-to-Action */}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => onSelectTab(currentProfile.ctaTab)}
                  className="px-5 py-3 rounded-2xl bg-[#FF633C] hover:bg-[#e05430] text-white text-sm font-bold shadow-md shadow-[#FF633C]/20 transition-all active:scale-95 flex items-center gap-2"
                >
                  <span>{isMn ? currentProfile.ctaMn : currentProfile.ctaEn}</span>
                  <span aria-hidden="true">→</span>
                </button>
                <span className="text-xs text-[#5C6275]">
                  {isMn
                    ? `${currentProfile.labelMn} горим идэвхтэй — цэс болон товч автоматаар таарна`
                    : `${currentProfile.labelEn} view active — header & actions tailored`}
                </span>
              </div>
            </section>

            {/* Mobile-First Citizen Quick Lookup Flow */}
            {audience === 'citizen' && (
              <CitizenRiskLookup
                language={language}
                onSelectTab={onSelectTab}
                onExploreMap={onExploreMap}
              />
            )}

            {/* Alert Header Icon + Problem Kicker */}
            <div className="flex items-center gap-3 mb-4 pt-6 border-t border-black/[0.06]">
              <div className="w-10 h-10 rounded-2xl bg-[#FF633C]/10 flex items-center justify-center text-[#FF633C] shrink-0">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-mono font-bold tracking-widest text-[#FF633C] uppercase">
                  {t.problemKicker}
                </span>
                <span className="text-xs text-[#5C6275]">
                  {language === 'mn' ? 'Улаанбаатарын орон зайн сорилт' : 'Urban Vulnerability Matrix'}
                </span>
              </div>
            </div>

            {/* Headline Prose */}
            <h2 className="font-editorial text-2xl sm:text-3xl font-bold text-[#0B124D] leading-snug mb-3 text-balance">
              {t.problemTitle}
            </h2>
            <p className="text-sm sm:text-base text-[#5C6275] leading-relaxed mb-8 max-w-2xl text-balance">
              {t.problemText}
            </p>

            {/* Solution Header */}
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-black/[0.06]">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#12B89A]" />
                <span className="text-xs font-mono font-bold tracking-wider text-[#0B124D] uppercase">
                  {t.solutionKicker}
                </span>
              </div>
              <span className="text-xs text-[#72778A]">
                {language === 'mn' ? '4 үндсэн тулгуур' : '4 Core Pillars'}
              </span>
            </div>

            {/* 4 Numbered Solution Blocks with semantic button accessibility */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-8">
              {solutions.map((item, idx) => {
                const isActive = activeSolutionIdx === idx;
                return (
                  <button
                    key={item.num}
                    type="button"
                    aria-label={item.title}
                    onClick={() => {
                      setActiveSolutionIdx(idx);
                      onSelectTab(item.tabTarget);
                    }}
                    className={`w-full p-3.5 sm:p-4 rounded-2xl border transition-all duration-200 cursor-pointer text-left group ${
                      isActive
                        ? 'border-[#FF633C] bg-orange-50/50 shadow-sm'
                        : 'border-black/[0.06] hover:border-black/20 hover:bg-[#F7F8FA] hover:-translate-y-0.5'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="w-7 h-7 rounded-full bg-[#FF633C] text-white flex items-center justify-center font-mono text-xs font-bold shrink-0 shadow-xs">
                        {item.num}
                      </div>
                      <span className="text-xs font-mono text-[#72778A] group-hover:text-[#0B124D]">
                        {item.tag} →
                      </span>
                    </div>
                    <h3 className="text-sm font-bold text-[#0B124D] mb-1 leading-snug flex items-center gap-1.5">
                      <span aria-hidden="true">{item.icon}</span>
                      <span>{item.title}</span>
                    </h3>
                    <p className="text-xs text-[#72778A] leading-relaxed line-clamp-2">
                      {item.desc}
                    </p>
                  </button>
                );
              })}
            </div>

          </div>

          {/* Interactive Smartphone App Preview Frame */}
          <div className="pt-6 border-t border-black/[0.06]">
            <div className="flex flex-col xl:flex-row items-center gap-6 bg-[#F7F8FA] p-3 sm:p-6 rounded-2xl sm:rounded-3xl border border-black/[0.05] w-full max-w-full overflow-hidden">
              
              {/* Phone Frame */}
              <div className="w-full max-w-[260px] sm:max-w-[290px] bg-[#0B124D] rounded-[36px] sm:rounded-[40px] p-2.5 sm:p-3 shadow-2xl ring-1 ring-black/10 shrink-0 mx-auto xl:mx-0">
                <div className="bg-white rounded-[28px] sm:rounded-[32px] p-3.5 sm:p-4 text-[#12152A] overflow-hidden flex flex-col justify-between min-h-[360px] sm:min-h-[380px]">
                  
                  {/* Phone Header */}
                  <div>
                    <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-100">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full bg-[#FF633C]" />
                        <span className="font-bold tracking-tight text-[#0B124D]">FIREWATCH UB</span>
                      </div>
                      <span className="text-xs font-mono text-slate-400 flex items-center gap-1">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            live.status === 'live'
                              ? 'bg-[#12B89A] animate-pulse'
                              : live.status === 'stale'
                              ? 'bg-amber-400'
                              : 'bg-slate-400'
                          }`}
                        />
                        {live.status === 'live'
                          ? 'LIVE'
                          : live.status === 'stale'
                          ? isMn
                            ? 'КЭШ'
                            : 'STALE'
                          : live.status === 'loading'
                          ? '…'
                          : 'OFFLINE'}
                      </span>
                    </div>

                    {/* Live fire-weather conditions, straight from the meteo feed */}
                    <div className="mt-2 flex items-center justify-between text-xs font-mono text-slate-500 bg-slate-50 rounded-lg px-2 py-1">
                      <span>{live.symbol} {live.tempCelsius}°C</span>
                      <span>{isMn ? 'Чийгшил' : 'RH'} {live.humidityPercent}%</span>
                      <span className="text-[#FF633C] font-bold">FWI {live.fireWeatherIndex}</span>
                    </div>

                    {/* Current Week Risk Indicator */}
                    <div className={`mt-2.5 sm:mt-3 p-2 sm:p-2.5 rounded-2xl border ${weekTone.box}`}>
                      <span className={`text-xs font-medium block ${weekTone.note}`}>
                        {t.phoneBadgeWeek}
                      </span>
                      <div className="flex items-baseline justify-between mt-0.5">
                        <span className={`font-editorial text-base sm:text-lg font-bold ${weekTone.strong}`}>
                          {language === 'mn' ? weekText.mn : weekText.en}
                        </span>
                        <span className={`font-mono text-xs font-bold tabular-nums ${weekTone.strong}`}>
                          {isMn ? 'эрсдэлийн индекс' : 'risk index'} {selectedMonth.riskScore}/100
                        </span>
                      </div>
                    </div>

                    {/* 12-Month Mini Calendar Strip */}
                    <div className="mt-2.5 sm:mt-3">
                      <span className="text-xs font-semibold text-slate-500 block mb-1.5">
                        {t.phoneCalendarTitle} ({isMn ? selectedMonth.nameMn : selectedMonth.nameEn})
                      </span>
                      <div className="grid grid-cols-6 gap-1">
                        {MONTH_RISK_CALENDAR.map((m, i) => {
                          const isSel = phoneMonthIdx === i;
                          const isHigh = m.riskScore >= 75;
                          return (
                            <button
                              key={m.month}
                              onClick={() => setPhoneMonthIdx(i)}
                              className={`py-1 rounded-lg text-xs font-mono font-bold transition-all text-center ${
                                isSel
                                  ? 'bg-[#0B124D] text-white shadow-xs'
                                  : isHigh
                                  ? 'bg-orange-100 text-[#FF633C] hover:bg-orange-200'
                                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                              }`}
                            >
                              {m.month}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* 3 Preventive Steps */}
                  <div className="mt-2.5 sm:mt-3 pt-2 border-t border-slate-100">
                    <span className="text-xs font-semibold text-slate-500 block mb-1.5">
                      {t.phoneStepsTitle}
                    </span>
                    <div className="space-y-1 text-xs">
                      <div className="flex items-center gap-1.5 text-slate-700">
                        <span className="w-3.5 h-3.5 rounded-full bg-[#FF633C] text-white text-xs font-mono flex items-center justify-center font-bold shrink-0">
                          1
                        </span>
                        <span className="truncate">{t.phoneStep1}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-slate-700">
                        <span className="w-3.5 h-3.5 rounded-full bg-[#FF633C] text-white text-xs font-mono flex items-center justify-center font-bold shrink-0">
                          2
                        </span>
                        <span className="truncate">{t.phoneStep2}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-slate-700">
                        <span className="w-3.5 h-3.5 rounded-full bg-[#FF633C] text-white text-xs font-mono flex items-center justify-center font-bold shrink-0">
                          3
                        </span>
                        <span className="truncate">{t.phoneStep3}</span>
                      </div>
                    </div>
                  </div>

                  {/* Mini Map preview button */}
                  <button
                    onClick={onExploreMap}
                    className="w-full mt-2.5 sm:mt-3 py-2 text-xs font-bold text-center bg-[#0B124D] hover:bg-[#11166B] text-white rounded-xl transition-all shadow-sm flex items-center justify-center gap-1 active:scale-95"
                  >
                    <span>{t.viewRiskMap}</span>
                    <span>→</span>
                  </button>
                </div>
              </div>

              {/* Story Description & Action buttons */}
              <div className="flex-1 text-left w-full min-w-0">
                <span className="text-xs font-mono font-bold text-[#FF633C] uppercase tracking-wider block mb-1">
                  {language === 'mn' ? 'ИРГЭНД ЧИГЛЭСЭН ТЕХНОЛОГИ' : 'HUMAN-CENTERED INTELLIGENCE'}
                </span>
                <h4 className="font-editorial text-lg sm:text-xl font-bold text-[#0B124D] mb-2 leading-snug">
                  {language === 'mn'
                    ? 'Ахмад настан, хүүхэд гэр бүл бүр хараад шууд ойлгох энгийн шийдэл'
                    : 'Clear, compassionate spatial safety designed for families and elders'}
                </h4>
                <p className="text-xs text-[#72778A] leading-relaxed mb-4">
                  {language === 'mn'
                    ? 'Хотын дүүрэг, хорооны халаалтын улирал, салхины хуурайшилт, хамгийн ойрын гал түймэр унтраах ангийн хүртээмжийг гар утас болон компьютер дээр бодит цаг хугацаанд хянана.'
                    : 'Track seasonal heating shifts, wind desiccation, and station coverage buffers seamlessly.'}
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectTab(currentProfile.ctaTab)}
                    className="px-4 sm:px-5 py-2 sm:py-2.5 text-xs font-bold text-white bg-[#FF633C] hover:bg-[#e05430] rounded-xl transition-all shadow-md shadow-[#FF633C]/20 flex items-center gap-1.5 active:scale-95"
                  >
                    <span>{isMn ? currentProfile.ctaMn : currentProfile.ctaEn}</span>
                    <span aria-hidden="true">→</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectTab('personal')}
                    className="px-3.5 sm:px-4 py-2 sm:py-2.5 text-xs font-bold text-[#0B124D] bg-[#0B124D]/8 hover:bg-[#0B124D]/15 rounded-xl transition-all flex items-center gap-1.5 active:scale-95"
                  >
                    <span aria-hidden="true">👤</span>
                    <span>{language === 'mn' ? 'Миний гэр' : 'Home Audit'}</span>
                  </button>
                  {onOpenFamilyMode && (
                    <button
                      type="button"
                      onClick={onOpenFamilyMode}
                      className="px-3.5 sm:px-4 py-2 sm:py-2.5 text-xs font-semibold text-amber-900 bg-amber-500/15 hover:bg-amber-500/25 rounded-xl transition-colors border border-amber-500/20 flex items-center gap-1.5"
                    >
                      <span aria-hidden="true">🏡</span>
                      <span>{language === 'mn' ? 'Гэр бүл' : 'Family'}</span>
                    </button>
                  )}
                </div>
              </div>

            </div>
          </div>

        </div>
      </div>
    </div>
  );
};
