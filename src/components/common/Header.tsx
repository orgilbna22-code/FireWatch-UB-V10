import React, { useEffect, useRef, useState } from 'react';
import { ActiveTab, Language, Theme, ViewMode } from '../../types';
import { soundEngine, useSoundStatus } from './AudioAmbiance';
import {
  ALL_TAB_METADATA,
  AUDIENCE_PROFILES,
  AudienceRole,
  getSecondaryTabsForAudience,
} from '../../utils/audienceSession';
import {
  FIRE_BG_EVENT,
  FireBackgroundMode,
  publishFireBgMode,
  readFireBgMode,
} from '../../utils/fireBgMode';

interface HeaderProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  language: Language;
  setLanguage: (lang: Language) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  audience: AudienceRole;
  onSelectAudience: (role: AudienceRole) => void;
  theme?: Theme;
  onToggleTheme?: () => void;
  onOpenDemoInfo: () => void;
  onToggleFamilyMode?: () => void;
  isFamilyModeOpen?: boolean;
  onOpenMobileMenu?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  language,
  setLanguage,
  audience,
  onSelectAudience,
  theme,
  onToggleTheme,
  onOpenDemoInfo,
  onToggleFamilyMode,
  isFamilyModeOpen,
  onOpenMobileMenu,
}) => {
  const isMn = language === 'mn';
  const soundOn = useSoundStatus();
  const [fireMode, setFireMode] = useState<FireBackgroundMode>(() => readFireBgMode('soft'));

  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isAudienceOpen, setIsAudienceOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const moreRef = useRef<HTMLDivElement | null>(null);
  const audienceRef = useRef<HTMLDivElement | null>(null);
  const settingsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onFireMode = (e: Event) => {
      const next = (e as CustomEvent<FireBackgroundMode>).detail;
      if (next === 'soft' || next === 'vivid' || next === 'off') {
        setFireMode(next);
      }
    };
    window.addEventListener(FIRE_BG_EVENT, onFireMode);
    return () => window.removeEventListener(FIRE_BG_EVENT, onFireMode);
  }, []);

  useEffect(() => {
    if (!isMoreOpen && !isAudienceOpen && !isSettingsOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (moreRef.current && !moreRef.current.contains(target)) setIsMoreOpen(false);
      if (audienceRef.current && !audienceRef.current.contains(target)) setIsAudienceOpen(false);
      if (settingsRef.current && !settingsRef.current.contains(target)) setIsSettingsOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMoreOpen(false);
        setIsAudienceOpen(false);
        setIsSettingsOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isMoreOpen, isAudienceOpen, isSettingsOpen]);

  const currentProfile = AUDIENCE_PROFILES[audience];
  const mainNavItems = currentProfile.mainTabs.slice(0, 4).map((id) => ({
    id,
    label: isMn ? ALL_TAB_METADATA[id].shortMn : ALL_TAB_METADATA[id].shortEn,
    title: isMn ? ALL_TAB_METADATA[id].fullMn : ALL_TAB_METADATA[id].fullEn,
  }));

  const secondaryNavItems = getSecondaryTabsForAudience(audience).map((id) => ({
    id,
    label: `${ALL_TAB_METADATA[id].icon} ${isMn ? ALL_TAB_METADATA[id].fullMn : ALL_TAB_METADATA[id].fullEn}`,
    shortLabel: isMn ? ALL_TAB_METADATA[id].shortMn : ALL_TAB_METADATA[id].shortEn,
  }));

  const activeSecondary = secondaryNavItems.find((item) => item.id === activeTab);

  const handleFireMode = (next: FireBackgroundMode) => {
    setFireMode(next);
    publishFireBgMode(next);
  };

  return (
    <header className="sticky top-0 z-[1100] bg-white/98 border-b border-black/[0.06] px-2 sm:px-6 lg:px-8 py-2 sm:py-3 transition-colors duration-200">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-1.5 sm:gap-3">
        {/* Zone 1: Brand wordmark + inline Audience switcher */}
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('citizen')}
            className="flex items-center gap-1.5 sm:gap-2 group text-left rounded-2xl p-0.5 sm:p-1 -ml-0.5 sm:-ml-1 transition-transform active:scale-95 shrink-0 min-h-[44px]"
          >
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-gradient-to-tr from-[#0B124D] to-[#11166B] flex items-center justify-center text-white shrink-0 shadow-sm shadow-[#0B124D]/20 group-hover:scale-105 transition-all">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="#FF633C"
                strokeWidth="2.4"
                className="w-4 h-4"
                aria-hidden="true"
              >
                <path d="M12 2C8 6 6 9 6 13a6 6 0 0 0 12 0c0-4-2-7-6-11z" />
                <path d="M12 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" fill="#FFFFFF" stroke="none" />
              </svg>
            </div>
            <span className="font-editorial text-[14px] sm:text-xl font-bold tracking-tight text-[#0B124D] whitespace-nowrap">
              FIREWATCH<span className="hidden min-[440px]:inline text-[#FF633C] font-mono text-xs ml-0.5 sm:ml-1 font-semibold tracking-normal">UB</span>
            </span>
          </button>

          {/* Compact Audience Role Switcher */}
          <div className="relative shrink-0" ref={audienceRef}>
            <button
              type="button"
              onClick={() => setIsAudienceOpen((v) => !v)}
              aria-haspopup="listbox"
              aria-expanded={isAudienceOpen}
              aria-label={isMn ? 'Хэрэглэгчийн төрөл солих' : 'Switch audience role'}
              className="flex items-center justify-center gap-1 px-2 sm:px-2.5 py-1.5 min-h-[44px] min-w-[44px] rounded-full bg-[#0B124D]/6 hover:bg-[#0B124D]/12 text-[#0B124D] text-xs font-semibold border border-black/[0.06] transition-colors whitespace-nowrap"
            >
              <span aria-hidden="true" className="shrink-0">{currentProfile.icon}</span>
              <span className="hidden min-[440px]:inline truncate max-w-[96px] sm:max-w-none">{isMn ? currentProfile.labelMn : currentProfile.labelEn}</span>
              <span className="text-xs opacity-70 shrink-0" aria-hidden="true">▾</span>
            </button>

            {isAudienceOpen && (
              <div
                role="listbox"
                aria-label={isMn ? 'Хэрэглэгчийн төрөл' : 'Audience roles'}
                className="absolute left-1/2 -translate-x-1/2 sm:left-0 sm:translate-x-0 top-full mt-1.5 w-64 bg-white rounded-2xl shadow-xl border border-black/[0.08] p-1.5 z-50"
              >
                {(['citizen', 'fire_command', 'police'] as AudienceRole[]).map((roleId) => {
                  const prof = AUDIENCE_PROFILES[roleId];
                  const selected = audience === roleId;
                  return (
                    <button
                      key={roleId}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        onSelectAudience(roleId);
                        setIsAudienceOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2.5 min-h-[44px] rounded-xl transition-colors flex items-start gap-2.5 ${
                        selected ? 'bg-[#0B124D] text-white' : 'text-[#0B124D] hover:bg-[#F7F8FA]'
                      }`}
                    >
                      <span className="text-base mt-0.5" aria-hidden="true">{prof.icon}</span>
                      <div className="min-w-0">
                        <div className="text-xs font-bold">{isMn ? prof.labelMn : prof.labelEn}</div>
                        <div className={`text-xs leading-snug ${selected ? 'text-white/80' : 'text-[#5C6275]'}`}>
                          {isMn ? prof.promiseMn : prof.promiseEn}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Zone 2: Max 4 Main Tabs for selected audience + More dropdown (Desktop) */}
        <nav
          aria-label={isMn ? 'Үндсэн цэс' : 'Primary navigation'}
          className="hidden lg:flex items-center gap-0.5 bg-[#F7F8FA]/90 p-1 rounded-full border border-black/[0.04]"
        >
          {mainNavItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                aria-current={isActive ? 'page' : undefined}
                title={item.title}
                className={`px-3 py-2 min-h-[44px] inline-flex items-center text-xs font-semibold rounded-full whitespace-nowrap transition-all duration-200 ${
                  isActive
                    ? 'bg-white text-[#0B124D] shadow-[0_2px_8px_rgba(0,0,0,0.06)]'
                    : 'text-[#5C6275] hover:text-[#0B124D]'
                }`}
              >
                {item.label}
              </button>
            );
          })}

          {/* Бусад / More Dropdown holding all secondary views */}
          <div className="relative" ref={moreRef}>
            <button
              type="button"
              onClick={() => setIsMoreOpen((v) => !v)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setIsMoreOpen(true);
                }
              }}
              aria-haspopup="true"
              aria-expanded={isMoreOpen}
              className={`px-3 py-2 min-h-[44px] text-xs font-semibold rounded-full transition-colors flex items-center gap-1 whitespace-nowrap ${
                activeSecondary
                  ? 'bg-white text-[#0B124D] shadow-[0_2px_8px_rgba(0,0,0,0.06)]'
                  : 'text-[#5C6275] hover:text-[#0B124D]'
              }`}
            >
              <span>
                {activeSecondary ? activeSecondary.shortLabel : isMn ? 'Бусад' : 'More'}
              </span>
              <svg
                className={`w-3 h-3 transition-transform ${isMoreOpen ? 'rotate-180' : ''}`}
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>

            {isMoreOpen && (
              <div className="absolute top-full right-0 mt-1.5 w-64 bg-white rounded-2xl shadow-xl border border-black/[0.08] p-1.5 z-50 max-h-[75vh] overflow-y-auto">
                {secondaryNavItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setIsMoreOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2.5 min-h-[44px] text-xs font-medium rounded-xl transition-colors flex items-center ${
                      activeTab === item.id
                        ? 'bg-[#0B124D]/8 text-[#0B124D] font-bold'
                        : 'text-[#5C6275] hover:bg-[#F7F8FA] hover:text-[#0B124D]'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}

                {onToggleFamilyMode && (
                  <div className="mt-1.5 pt-1.5 border-t border-black/[0.06]">
                    <button
                      type="button"
                      aria-pressed={isFamilyModeOpen}
                      onClick={() => {
                        onToggleFamilyMode();
                        setIsMoreOpen(false);
                      }}
                      className="w-full text-left px-3 py-2.5 min-h-[44px] text-xs font-semibold rounded-xl text-amber-900 bg-amber-50 hover:bg-amber-100 transition-colors flex items-center"
                    >
                      🏡 {isMn ? 'Гэр бүл, ахмадын хялбар горим' : 'Family & Elder Easy View'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </nav>

        {/* Zone 3: Compact Right Side (Settings Menu + 1 Primary Audience CTA + Mobile Menu) */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Compact Language Quick Toggle */}
          <button
            type="button"
            onClick={() => setLanguage(isMn ? 'en' : 'mn')}
            className="w-11 h-11 text-xs font-mono font-bold text-[#0B124D] hover:bg-[#0B124D]/5 rounded-full transition-colors border border-black/[0.08] flex items-center justify-center shrink-0"
            aria-label={isMn ? 'Switch language to English' : 'Хэлийг Монгол болгох'}
          >
            {isMn ? 'EN' : 'MN'}
          </button>

          {/* Compact Settings Menu (Theme, Sound, Backdrop Fire, Governance) */}
          <div className="relative" ref={settingsRef}>
            <button
              type="button"
              onClick={() => setIsSettingsOpen((v) => !v)}
              aria-haspopup="true"
              aria-expanded={isSettingsOpen}
              aria-label={isMn ? 'Дэлгэц ба дууны тохиргоо' : 'Display & audio settings'}
              title={isMn ? 'Тохиргоо' : 'Settings'}
              className="w-11 h-11 rounded-full text-sm flex items-center justify-center transition-colors text-[#5C6275] hover:text-[#0B124D] hover:bg-black/5 border border-black/[0.08]"
            >
              <span aria-hidden="true">⚙️</span>
            </button>

            {isSettingsOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-68 bg-white rounded-2xl shadow-xl border border-black/[0.08] p-3 z-50 space-y-3 text-xs">
                <div className="font-mono text-xs font-bold uppercase tracking-wider text-[#5C6275]">
                  {isMn ? 'Тохиргоо' : 'Preferences'}
                </div>

                {onToggleTheme && (
                  <button
                    type="button"
                    onClick={onToggleTheme}
                    aria-pressed={theme === 'dark'}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-[#F7F8FA] hover:bg-slate-100 text-[#0B124D] font-semibold flex items-center justify-between"
                  >
                    <span>{theme === 'dark' ? (isMn ? '☀️ Өдрийн горим' : '☀️ Light theme') : (isMn ? '🌙 Шөнийн горим' : '🌙 Dark theme')}</span>
                    <span className="text-xs font-mono opacity-80">{theme === 'dark' ? 'DARK' : 'LIGHT'}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => soundEngine.toggle()}
                  aria-pressed={soundOn}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-[#F7F8FA] hover:bg-slate-100 text-[#0B124D] font-semibold flex items-center justify-between"
                >
                  <span>{soundOn ? (isMn ? '🔥 Галын чимээ: Асаалттай' : '🔥 Hearth sound: On') : (isMn ? '🔇 Галын чимээ: Хаалттай' : '🔇 Hearth sound: Muted')}</span>
                </button>

                <div className="space-y-1.5">
                  <div className="text-xs font-mono text-[#5C6275] px-1">
                    {isMn ? 'Арын галын дөл' : 'Backdrop flame'}
                  </div>
                  <div className="grid grid-cols-3 gap-1 bg-[#F7F8FA] p-1 rounded-xl">
                    {(['soft', 'vivid', 'off'] as FireBackgroundMode[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => handleFireMode(m)}
                        aria-pressed={fireMode === m}
                        className={`min-h-[44px] py-2 rounded-lg text-xs font-bold transition-colors ${
                          fireMode === m ? 'bg-[#0B124D] text-white' : 'text-[#5C6275] hover:text-[#0B124D]'
                        }`}
                      >
                        {m === 'soft' ? (isMn ? 'Зөөлөн' : 'Soft') : m === 'vivid' ? (isMn ? 'Тод' : 'Vivid') : (isMn ? 'Хаах' : 'Off')}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onOpenDemoInfo();
                    setIsSettingsOpen(false);
                  }}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-black/[0.08] text-[#0B124D] font-semibold hover:bg-[#F7F8FA] text-left"
                >
                  ℹ️ {isMn ? 'Өгөгдлийн эх сурвалж & аргачлал' : 'Data sources & methodology'}
                </button>
              </div>
            )}
          </div>

          {/* ONE Primary CTA per audience (Desktop) */}
          <button
            type="button"
            onClick={() => setActiveTab(currentProfile.ctaTab)}
            className={`hidden lg:flex px-4 py-1.5 text-xs font-semibold rounded-full transition-all shadow-sm active:scale-95 whitespace-nowrap min-h-[44px] items-center justify-center ${
              activeTab === currentProfile.ctaTab
                ? 'bg-[#FF633C] text-white ring-2 ring-[#FF633C]/40'
                : 'bg-[#0B124D] hover:bg-[#11166B] text-white'
            }`}
          >
            <span>{isMn ? currentProfile.ctaMn : currentProfile.ctaEn}</span>
          </button>

          {/* Mobile Menu Trigger */}
          {onOpenMobileMenu && (
            <button
              type="button"
              onClick={onOpenMobileMenu}
              className="lg:hidden w-11 h-11 rounded-full bg-slate-100 hover:bg-slate-200 text-[#0B124D] flex items-center justify-center transition-colors text-base font-bold shrink-0 shadow-2xs"
              aria-label={isMn ? 'Цэс нээх' : 'Open menu'}
            >
              ☰
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
