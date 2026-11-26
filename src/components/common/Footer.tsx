import React from 'react';
import { ActiveTab, Language } from '../../types';
import { getTranslation } from '../../i18n/translations';
import { EMERGENCY_DISPATCH, getMaintainerMailto } from '../../data/emergencyContacts';
import { PWAInstallButton } from './PWAStatus';

interface FooterProps {
  language: Language;
  onSelectTab: (tab: ActiveTab) => void;
  onOpenSources: () => void;
  onOpenAbout?: () => void;
}

export const Footer: React.FC<FooterProps> = ({
  language,
  onSelectTab,
  onOpenSources,
  onOpenAbout,
}) => {
  const t = getTranslation(language);
  const reportHref = getMaintainerMailto(
    language === 'mn' ? 'FireWatch UB — Өгөгдлийн алдаа мэдээлэх' : 'FireWatch UB — Issue Report'
  );

  return (
    <footer className="relative z-10 w-full bg-[#0B124D] text-white border-t border-white/15 pt-16 pb-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-12">
        
        {/* Main Footer Row */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 pb-12 border-b border-white/10">
          
          {/* Brand Info (5 cols) */}
          <div className="md:col-span-5 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-[#FF633C] flex items-center justify-center text-white">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 2C8 6 6 9 6 13a6 6 0 0 0 12 0c0-4-2-7-6-11z" />
                </svg>
              </div>
              <span className="font-editorial text-2xl font-bold tracking-tight text-white">
                FIREWATCH<span className="text-[#FF633C] font-mono text-base ml-1">UB</span>
              </span>
            </div>

            <p className="font-editorial text-lg text-white/90 italic max-w-sm">
              “{t.tagline}”
            </p>

            <p className="text-xs text-white/60 leading-relaxed max-w-sm">
              {language === 'mn'
                ? 'Улаанбаатар хотын галын эрсдэлийн орон зайн тандалт, дүүргүүдийн шинжилгээ, олон нийтийн аюулгүй байдлын мэдээллийн бие даасан судалгааны загвар.'
                : 'Independent Ulaanbaatar spatial fire-risk research prototype and civil emergency awareness platform.'}
            </p>
          </div>

          {/* Nav Links (3 cols) */}
          <div className="md:col-span-3 space-y-3">
            <span className="text-xs font-mono font-bold uppercase tracking-widest text-[#FF633C] block mb-2">
              {language === 'mn' ? 'ПЛАТФОРМ' : 'PLATFORM'}
            </span>
            <ul className="space-y-2 text-xs text-white/70 font-medium">
              <li>
                <button onClick={() => onSelectTab('map')} className="hover:text-white transition-colors">
                  {t.navMap}
                </button>
              </li>
              <li>
                <button onClick={() => onSelectTab('overview')} className="hover:text-white transition-colors">
                  {t.navOverview}
                </button>
              </li>
              <li>
                <button onClick={() => onSelectTab('explorer')} className="hover:text-white transition-colors">
                  {t.navExplorer}
                </button>
              </li>
              <li>
                <button onClick={() => onSelectTab('districts')} className="hover:text-white transition-colors">
                  {t.navDistricts}
                </button>
              </li>
              <li>
                <button onClick={() => onSelectTab('calendar')} className="hover:text-white transition-colors">
                  {t.navCalendar}
                </button>
              </li>
            </ul>
          </div>

          {/* Governance & Safety (4 cols) */}
          <div className="md:col-span-4 space-y-3">
            <span className="text-xs font-mono font-bold uppercase tracking-widest text-[#FF633C] block mb-2">
              {language === 'mn' ? 'МЭДЭЭЛЭЛ & СТАНДАРТ' : 'SAFETY & GOVERNANCE'}
            </span>
            <ul className="space-y-2 text-xs text-white/70 font-medium">
              <li>
                <button onClick={() => onSelectTab('safety')} className="hover:text-white transition-colors">
                  {t.navSafety}
                </button>
              </li>
              <li>
                <button onClick={onOpenSources} className="hover:text-white transition-colors">
                  {t.navSources}
                </button>
              </li>
              <li>
                <button onClick={() => onSelectTab('reports')} className="hover:text-white transition-colors">
                  {t.navReports}
                </button>
              </li>
              {onOpenAbout && (
                <li>
                  <button onClick={onOpenAbout} className="hover:text-white transition-colors">
                    {language === 'mn' ? 'Төслийн тухай & Нууцлал' : 'About, Privacy & Disclaimers'}
                  </button>
                </li>
              )}
              <li>
                <a href={reportHref} className="hover:text-[#FF633C] transition-colors inline-block">
                  {language === 'mn' ? 'Буруу өгөгдөл мэдээлэх' : 'Report wrong data'}
                </a>
              </li>
              <li>
                <span className="text-white/50 block pt-2 text-xs">
                  {language === 'mn' ? 'Онцгой байдлын утас (Монгол):' : 'Emergency dispatch (Mongolia):'}{' '}
                  <a href={`tel:${EMERGENCY_DISPATCH.fire}`} className="text-white font-mono hover:text-[#FF633C] transition-colors">
                    {EMERGENCY_DISPATCH.fire}
                  </a>
                  ,{' '}
                  <a href={`tel:${EMERGENCY_DISPATCH.rescue}`} className="text-white font-mono hover:text-[#FF633C] transition-colors">
                    {EMERGENCY_DISPATCH.rescue}
                  </a>
                </span>
              </li>
            </ul>
          </div>

        </div>

        {/* Disclaimer & Copyright */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs text-white/60 font-mono">
          <p className="max-w-2xl leading-relaxed text-xs">
            ⚠️ {t.footerDisclaimer}{' '}
            {language === 'mn'
              ? 'Энэхүү платформ нь судалгаа, иргэдийн бэлэн байдалд зориулсан демо систем бөгөөд онцгой байдлын албан ёсны зарлан мэдээлэх системийг орлохгүй.'
              : 'Independent research & demo prototype. Estimates rely on public spatial indicators and do NOT replace official emergency dispatch or directives.'}
          </p>
          <div className="shrink-0 flex flex-col sm:items-end gap-2 text-right text-xs">
            <PWAInstallButton language={language} />
            <span>© 2026–2027 FIREWATCH UB</span>
          </div>
        </div>

      </div>
    </footer>
  );
};
