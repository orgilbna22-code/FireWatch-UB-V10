import React, { useState } from 'react';
import { Compass, Info, MapPin, PhoneCall, ShieldCheck } from 'lucide-react';
import { ActiveTab, Language } from '../../types';
import { UB_DISTRICTS, UB_KHOROOS } from '../../data/ubGeoData';
import { EMERGENCY_DISPATCH } from '../../data/emergencyContacts';
import { useLiveWeather } from '../../hooks/liveWeather';
import { CitizenRiskLookup } from './CitizenRiskLookup';

interface CitizenHomePageProps {
  language: Language;
  onSelectTab: (tab: ActiveTab) => void;
  onExploreMap: (districtId?: string) => void;
  onOpenDemoInfo: () => void;
}

const UB_CENTER_LAT = 47.9184;
const UB_CENTER_LNG = 106.9177;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const CitizenHomePage: React.FC<CitizenHomePageProps> = ({
  language,
  onSelectTab,
  onExploreMap,
  onOpenDemoInfo,
}) => {
  const isMn = language === 'mn';
  const live = useLiveWeather();
  const [geoSelection, setGeoSelection] = useState<{ districtId: string; khorooId: string } | null>(null);
  const [geoState, setGeoState] = useState<{
    status: 'idle' | 'locating' | 'found' | 'outside_ub' | 'denied' | 'unsupported';
    label?: string;
  }>({ status: 'idle' });

  const handleFindMyKhoroo = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoState({ status: 'unsupported' });
      return;
    }
    setGeoState({ status: 'locating' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const distFromUb = haversineKm(latitude, longitude, UB_CENTER_LAT, UB_CENTER_LNG);
        if (distFromUb > 65) {
          setGeoState({ status: 'outside_ub' });
          return;
        }
        let nearest = UB_KHOROOS[0];
        let minKm = Infinity;
        for (const k of UB_KHOROOS) {
          const d = haversineKm(latitude, longitude, k.center[0], k.center[1]);
          if (d < minKm) {
            minKm = d;
            nearest = k;
          }
        }
        if (nearest) {
          const dist = UB_DISTRICTS.find((d) => d.id === nearest.districtId);
          setGeoSelection({ districtId: nearest.districtId, khorooId: nearest.id });
          setGeoState({
            status: 'found',
            label: isMn
              ? `${dist?.nameMn ?? nearest.districtId}, ${nearest.khorooNumber}-р хороо (~${minKm.toFixed(1)} км)`
              : `${dist?.nameEn ?? nearest.districtId}, Khoroo ${nearest.khorooNumber} (~${minKm.toFixed(1)} km)`,
          });
        }
      },
      () => {
        setGeoState({ status: 'denied' });
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 }
    );
  };

  return (
    <div className="w-full max-w-[1440px] mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-5">
      {/* Compact Navy Hero & Live Open-Meteo Bar */}
      <section
        aria-label={isMn ? 'Иргэний галын эрсдэлийн нүүр' : 'Citizen fire risk overview'}
        className="rounded-[28px] sm:rounded-[32px] bg-gradient-to-br from-[#0B124D] via-[#0F185C] to-[#1A1645] text-white p-5 sm:p-8 border border-white/15 shadow-[0_24px_60px_-15px_rgba(6,10,36,0.45)]"
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-3 max-w-2xl">
            <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-[#FF8C6E] font-bold">
              <span className="w-2 h-2 rounded-full bg-[#FF8C6E]" aria-hidden="true" />
              <span>{isMn ? 'УЛААНБААТАР · ИРГЭНИЙ ЭХЛЭЛ' : 'ULAANBAATAR · CITIZEN HOME'}</span>
            </div>
            <h1 className="font-editorial text-2xl sm:text-4xl font-bold leading-tight text-balance">
              {isMn
                ? 'Танай хорооны галын эрсдэл ба өнөөдөр хийх 3 алхам'
                : 'Your khoroo fire risk & 3 practical steps today'}
            </h1>
            <p className="text-sm sm:text-base text-white/85 leading-relaxed">
              {isMn
                ? 'Өөрийн дүүрэг, хороог сонгож жишээ суурь үзүүлэлт, бодит цаг агаарын нөлөө болон аюулгүй байдлын алхмуудыг шалгаарай.'
                : 'Select your district and khoroo below to view baseline structural factors, live Open-Meteo weather impact, and practical home prevention steps.'}
            </p>

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={handleFindMyKhoroo}
                disabled={geoState.status === 'locating'}
                className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2.5 rounded-xl bg-[#FF633C] hover:bg-[#e05430] text-white text-xs sm:text-sm font-bold shadow-md transition-colors disabled:opacity-60"
              >
                <Compass className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>
                  {geoState.status === 'locating'
                    ? isMn
                      ? 'Байрлал тодорхойлж байна…'
                      : 'Locating…'
                    : isMn
                    ? 'Миний байрлалаар олох'
                    : 'Find by my location'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => onExploreMap()}
                className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2.5 rounded-xl bg-white/12 hover:bg-white/20 text-white text-xs sm:text-sm font-semibold border border-white/15 transition-colors"
              >
                <MapPin className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{isMn ? 'Эрсдэлийн зураг' : 'Risk Map'}</span>
              </button>

              <button
                type="button"
                onClick={() => onSelectTab('landing')}
                className="inline-flex items-center gap-1.5 min-h-[44px] px-4 py-2.5 rounded-xl bg-transparent hover:bg-white/10 text-white/90 text-xs sm:text-sm font-semibold border border-white/15 transition-colors"
              >
                <Info className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{isMn ? 'Төслийн тухай' : 'About project'}</span>
              </button>
            </div>

            {geoState.status !== 'idle' && (
              <p
                role="status"
                aria-live="polite"
                className="text-xs font-mono text-white/90 bg-white/10 border border-white/15 rounded-xl px-3 py-2"
              >
                {geoState.status === 'found' &&
                  (isMn
                    ? `📍 Хамгийн ойрын хороо: ${geoState.label}`
                    : `📍 Nearest khoroo matched: ${geoState.label}`)}
                {geoState.status === 'outside_ub' &&
                  (isMn
                    ? 'Таны байршил Улаанбаатараас гадна илэрсэн тул доороос гараар дүүрэг, хороо сонгоно уу.'
                    : 'Your location appears outside Ulaanbaatar — please select a district and khoroo manually below.')}
                {geoState.status === 'denied' &&
                  (isMn
                    ? 'Байршил хуваалцах зөвшөөрөл өгөгдсөнгүй. Доорх цэсээс хороогоо гараар сонгоно уу.'
                    : 'Location permission was declined. Please choose your district and khoroo manually below.')}
                {geoState.status === 'unsupported' &&
                  (isMn
                    ? 'Таны хөтөч байршил тодорхойлохыг дэмжихгүй байна.'
                    : 'Geolocation is not supported in this browser.')}
              </p>
            )}
          </div>

          {/* Live Open-Meteo Telemetry + Emergency 101 / 105 Strip */}
          <div className="lg:w-[340px] shrink-0 space-y-3">
            <div className="rounded-2xl bg-white/10 border border-white/15 p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2 text-xs font-mono">
                <span className="font-bold text-white/90">
                  {live.symbol} Open-Meteo · 47.92°N
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#63E6BE]">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      live.status === 'live'
                        ? 'bg-[#12B89A]'
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
                      : 'CACHED'
                    : isMn
                    ? 'СУУРЬ'
                    : 'BASELINE'}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center font-mono">
                <div className="rounded-xl bg-black/20 p-2">
                  <div className="text-xs text-white/75">{isMn ? 'Дулаан' : 'Temp'}</div>
                  <div className="text-sm font-bold text-white tabular-nums">{live.tempCelsius}°C</div>
                </div>
                <div className="rounded-xl bg-black/20 p-2">
                  <div className="text-xs text-white/75">{isMn ? 'Чийг' : 'RH'}</div>
                  <div className="text-sm font-bold text-white tabular-nums">{live.humidityPercent}%</div>
                </div>
                <div className="rounded-xl bg-black/20 p-2">
                  <div className="text-xs text-white/75">{isMn ? 'Салхи' : 'Wind'}</div>
                  <div className="text-sm font-bold text-white tabular-nums">
                    {live.windSpeedKmh} <span className="text-xs font-normal">km/h</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-[#E93B2F]/20 border border-[#FF633C]/40 p-3.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-mono font-bold text-[#FF9A8D] uppercase">
                  {isMn ? 'Яаралтай дуудлага 24/7' : 'Emergency Dispatch 24/7'}
                </div>
                <div className="text-xs text-white/90">
                  {isMn ? 'Гал, утаа гарвал шууд залгах' : 'Dial immediately for fire or smoke'}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={`tel:${EMERGENCY_DISPATCH.fire}`}
                  className="inline-flex items-center justify-center min-h-[44px] min-w-[54px] px-3 rounded-xl bg-[#E93B2F] hover:bg-red-600 text-white font-mono text-sm font-extrabold transition-colors"
                >
                  {EMERGENCY_DISPATCH.fire}
                </a>
                <a
                  href={`tel:${EMERGENCY_DISPATCH.rescue}`}
                  className="inline-flex items-center justify-center min-h-[44px] min-w-[54px] px-3 rounded-xl bg-white/15 hover:bg-white/25 text-white font-mono text-sm font-bold transition-colors"
                >
                  {EMERGENCY_DISPATCH.rescue}
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Main White Card Container: CitizenRiskLookup + Secondary Links */}
      <div className="rounded-[28px] sm:rounded-[32px] bg-white border border-black/10 dark:border-white/10 shadow-[0_20px_50px_-15px_rgba(6,10,36,0.34)] p-4 sm:p-7 space-y-6">
        <CitizenRiskLookup
          language={language}
          onSelectTab={onSelectTab}
          onExploreMap={(distId) => onExploreMap(distId)}
          externalSelection={geoSelection}
        />

        {/* Clean Secondary Navigation Strip */}
        <div className="pt-4 border-t border-black/[0.06] flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => onSelectTab('personal')}
              className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-xl bg-[#F7F8FA] hover:bg-slate-100 border border-black/10 text-[#0B124D] text-xs sm:text-sm font-bold transition-colors"
            >
              <ShieldCheck className="w-4 h-4 text-[#12B89A]" aria-hidden="true" />
              <span>{isMn ? 'Гэрийн аюулгүй байдлын аудит' : 'Home Safety Audit'}</span>
            </button>

            <button
              type="button"
              onClick={() => onSelectTab('safety')}
              className="inline-flex items-center gap-2 min-h-[44px] px-4 py-2 rounded-xl bg-[#F7F8FA] hover:bg-slate-100 border border-black/10 text-[#0B124D] text-xs sm:text-sm font-bold transition-colors"
            >
              <PhoneCall className="w-4 h-4 text-[#FF633C]" aria-hidden="true" />
              <span>{isMn ? 'Аюулгүй байдлын гарын авлага' : 'Safety Guidelines'}</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onOpenDemoInfo}
            className="min-h-[44px] px-4 py-2 rounded-xl text-xs font-mono font-bold text-[#5C6275] hover:text-[#0B124D] underline transition-colors"
          >
            {isMn ? 'Өгөгдлийн эх сурвалж ба Demo тайлбар' : 'Data sources & demo notice'}
          </button>
        </div>
      </div>
    </div>
  );
};
