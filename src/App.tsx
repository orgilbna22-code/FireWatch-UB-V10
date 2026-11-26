import React, { Suspense, lazy, useCallback, useState, useEffect } from 'react';
import { ActiveTab, Language, ViewMode } from './types';
import { Header } from './components/common/Header';
import { Footer } from './components/common/Footer';
import { CitizenHomePage } from './components/citizen/CitizenHomePage';
import { MobileBottomNav } from './components/common/MobileBottomNav';
import { OfflineIndicator } from './components/common/PWAStatus';
import { useTheme } from './hooks/useTheme';
import { liveWeather } from './hooks/liveWeather';
import { useApiAvailability } from './utils/apiClient';
import { AudienceRole, readSavedAudience, saveAudience } from './utils/audienceSession';
import { FIRE_BG_EVENT, readFireBgMode } from './utils/fireBgMode';

const LandingHero = lazy(() =>
  import('./components/landing/LandingHero').then((m) => ({ default: m.LandingHero }))
);
const LandingSections = lazy(() =>
  import('./components/landing/LandingSections').then((m) => ({ default: m.LandingSections }))
);
const DataSourcesModal = lazy(() =>
  import('./components/common/DataSourcesModal').then((m) => ({ default: m.DataSourcesModal }))
);
const AboutModal = lazy(() =>
  import('./components/common/AboutModal').then((m) => ({ default: m.AboutModal }))
);
const FamilyQuickView = lazy(() =>
  import('./components/common/FamilyQuickView').then((m) => ({ default: m.FamilyQuickView }))
);
const MobileMenuDrawer = lazy(() =>
  import('./components/common/MobileMenuDrawer').then((m) => ({ default: m.MobileMenuDrawer }))
);
const GlobalFireBackground = lazy(() =>
  import('./components/common/GlobalFireBackground').then((m) => ({ default: m.GlobalFireBackground }))
);

const RiskMap = lazy(() => import('./components/map/RiskMap').then((m) => ({ default: m.RiskMap })));
const OverviewDashboard = lazy(() =>
  import('./components/dashboard/OverviewDashboard').then((m) => ({ default: m.OverviewDashboard }))
);
const RiskExplorer = lazy(() =>
  import('./components/explorer/RiskExplorer').then((m) => ({ default: m.RiskExplorer }))
);
const DistrictAnalysis = lazy(() =>
  import('./components/districts/DistrictAnalysis').then((m) => ({ default: m.DistrictAnalysis }))
);
const IncidentHistory = lazy(() =>
  import('./components/incidents/IncidentHistory').then((m) => ({ default: m.IncidentHistory }))
);
const EmergencyCoverage = lazy(() =>
  import('./components/emergency/EmergencyCoverage').then((m) => ({ default: m.EmergencyCoverage }))
);
const RiskCalendar = lazy(() =>
  import('./components/calendar/RiskCalendar').then((m) => ({ default: m.RiskCalendar }))
);
const WeatherModule = lazy(() =>
  import('./components/weather/WeatherModule').then((m) => ({ default: m.WeatherModule }))
);
const SafetyCenter = lazy(() =>
  import('./components/safety/SafetyCenter').then((m) => ({ default: m.SafetyCenter }))
);
const ReportCenter = lazy(() =>
  import('./components/reports/ReportCenter').then((m) => ({ default: m.ReportCenter }))
);
const AdminDataGate = lazy(() =>
  import('./components/common/AdminDataGate').then((m) => ({ default: m.AdminDataGate }))
);
const FireSimulationLab = lazy(() =>
  import('./components/simulation/FireSimulationLab').then((m) => ({ default: m.FireSimulationLab }))
);
const PersonalPortal = lazy(() =>
  import('./components/personal/PersonalPortal').then((m) => ({ default: m.PersonalPortal }))
);
const PolicePlaceholder = lazy(() =>
  import('./components/police/PolicePlaceholder').then((m) => ({ default: m.PolicePlaceholder }))
);

const VALID_TABS: ActiveTab[] = [
  'citizen', 'landing', 'overview', 'map', 'explorer', 'districts', 'incidents',
  'calendar', 'emergency', 'weather', 'safety', 'reports', 'sources', 'personal', 'police',
];

function parseHashToTab(rawHash: string): ActiveTab | null {
  const cleaned = rawHash.replace('#', '').trim().toLowerCase();
  if (cleaned === 'about') return 'landing';
  return VALID_TABS.includes(cleaned as ActiveTab) ? (cleaned as ActiveTab) : null;
}

function getInitialTab(): ActiveTab {
  return parseHashToTab(window.location.hash) ?? 'citizen';
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>(getInitialTab);
  const [language, setLanguage] = useState<Language>('mn');
  const [audience, setAudience] = useState<AudienceRole>(() => readSavedAudience());
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    readSavedAudience() === 'fire_command' ? 'pro' : 'public'
  );
  const [selectedDistrictId, setSelectedDistrictId] = useState<string>('bayanzurkh');
  const [isDataSourcesModalOpen, setIsDataSourcesModalOpen] = useState(false);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  const [isFamilyModeOpen, setIsFamilyModeOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [demoNoticeDismissed, setDemoNoticeDismissed] = useState(false);
  const [fireBgReady, setFireBgReady] = useState(false);
  const [savedBgMode, setSavedBgMode] = useState(() => readFireBgMode('soft'));
  const { theme, toggleTheme } = useTheme();
  const apiHealth = useApiAvailability(language);

  // Defer ambient canvas bundle until browser is idle after first paint
  useEffect(() => {
    const win = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const onBgChange = (e: Event) => {
      const next = (e as CustomEvent).detail;
      if (next === 'soft' || next === 'vivid' || next === 'off') {
        setSavedBgMode(next);
        setFireBgReady(true);
      }
    };
    window.addEventListener(FIRE_BG_EVENT, onBgChange);
    if (typeof win.requestIdleCallback === 'function') {
      const id = win.requestIdleCallback(() => setFireBgReady(true), { timeout: 600 });
      return () => {
        window.removeEventListener(FIRE_BG_EVENT, onBgChange);
        win.cancelIdleCallback?.(id);
      };
    }
    const timer = window.setTimeout(() => setFireBgReady(true), 200);
    return () => {
      window.removeEventListener(FIRE_BG_EVENT, onBgChange);
      window.clearTimeout(timer);
    };
  }, []);

  // Single shared LIVE weather feed (Open-Meteo) for map ticker, dashboard and weather views
  useEffect(() => {
    liveWeather.start();
    return () => liveWeather.stop();
  }, []);

  // Respect reduced motion preference when scrolling on route changes
  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: prefersReduced ? 'auto' : 'smooth' });
  }, [activeTab]);

  // Keep URL hash in sync so tabs survive refresh and can be deep-linked
  useEffect(() => {
    const target = `#${activeTab}`;
    if (window.location.hash !== target) {
      window.history.replaceState(null, '', target);
    }
  }, [activeTab]);

  useEffect(() => {
    const onHashChange = () => {
      const next = parseHashToTab(window.location.hash);
      if (next) {
        setActiveTab((cur) => (cur === next ? cur : next));
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Stable identities keep overlay key-listeners and focus timers from
  // re-registering on every App render.
  const closeMobileMenu = useCallback(() => setIsMobileMenuOpen(false), []);
  const closeSourcesModal = useCallback(() => setIsDataSourcesModalOpen(false), []);
  const closeAboutModal = useCallback(() => setIsAboutModalOpen(false), []);
  const closeFamilyMode = useCallback(() => setIsFamilyModeOpen(false), []);

  const handleSelectAudience = useCallback((nextRole: AudienceRole) => {
    setAudience(nextRole);
    saveAudience(nextRole);
    setViewMode(nextRole === 'fire_command' ? 'pro' : 'public');
  }, []);

  const handleSelectDistrictAndMap = (districtId: string) => {
    setSelectedDistrictId(districtId);
    setActiveTab('map');
  };

  const handleSelectDistrictAndDetail = (districtId: string) => {
    setSelectedDistrictId(districtId);
    setActiveTab('districts');
  };

  return (
    <div className="min-h-screen flex flex-col bg-transparent text-[#12152A] antialiased selection:bg-[#FF633C]/20 selection:text-[#0B124D] relative w-full max-w-full overflow-x-clip">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[1500] focus:px-4 focus:py-2 focus:rounded-xl focus:bg-[#0B124D] focus:text-white focus:text-xs focus:font-bold focus:shadow-lg"
      >
        {language === 'mn' ? 'Үндсэн хэсэг рүү очих' : 'Skip to main content'}
      </a>

      {/* Static instant backdrop shell until idle-loaded canvas mounts (zero layout shift or flash) */}
      {activeTab !== 'map' && savedBgMode !== 'off' && !fireBgReady && (
        <div
          className="fixed inset-0 z-0 pointer-events-none"
          style={{
            background:
              savedBgMode === 'vivid'
                ? 'linear-gradient(175deg, #070B2A 0%, #12123B 38%, #281128 72%, #3D1418 100%)'
                : 'linear-gradient(175deg, #070B28 0%, #0D1442 44%, #1A1333 76%, #28121E 100%)',
          }}
          aria-hidden="true"
        />
      )}
      {fireBgReady && (
        <Suspense fallback={null}>
          <GlobalFireBackground initialMode="soft" language={language} hideRibbon={activeTab === 'map'} />
        </Suspense>
      )}

      {/* Universal Top Navigation Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        language={language}
        setLanguage={setLanguage}
        viewMode={viewMode}
        setViewMode={setViewMode}
        audience={audience}
        onSelectAudience={handleSelectAudience}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenDemoInfo={() => setIsDataSourcesModalOpen(true)}
        onToggleFamilyMode={() => setIsFamilyModeOpen(!isFamilyModeOpen)}
        isFamilyModeOpen={isFamilyModeOpen}
        onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
      />

      {/* Optional Family & Elder Friendly Quick Modal Overlay (lazy-loaded on demand) */}
      {isFamilyModeOpen && (
        <Suspense fallback={null}>
          <FamilyQuickView
            language={language}
            onClose={closeFamilyMode}
            onOpenMap={() => {
              setIsFamilyModeOpen(false);
              setActiveTab('map');
            }}
          />
        </Suspense>
      )}

      {/* Static-host / backend-offline notice */}
      {apiHealth.status === 'unavailable' && !demoNoticeDismissed && (
        <div
          role="status"
          className="relative z-40 bg-amber-50 border-b border-amber-200 px-4 py-2 text-xs text-amber-950 flex flex-wrap items-center justify-center gap-3"
        >
          <span className="font-medium">
            {language === 'mn'
              ? 'Энэ демо хувилбарт AI тайлбар болон хадгалалт идэвхгүй.'
              : 'AI explanation and server saving are disabled in this demo.'}
          </span>
          <button
            type="button"
            onClick={() => void apiHealth.recheck()}
            className="min-h-[44px] px-3 py-1 rounded-lg bg-white border border-amber-300 text-xs font-bold text-amber-900 hover:bg-amber-100"
          >
            {language === 'mn' ? 'Дахин шалгах' : 'Retry'}
          </button>
          <button
            type="button"
            onClick={() => setDemoNoticeDismissed(true)}
            aria-label={language === 'mn' ? 'Хаах' : 'Dismiss'}
            className="min-h-[44px] min-w-[44px] text-amber-800 hover:text-amber-950 font-bold px-2 flex items-center justify-center"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main View Router with Apple-Grade Smooth Transition & Code Splitting */}
      <main
        id="main-content"
        tabIndex={-1}
        className={`flex-1 flex flex-col relative z-10 w-full max-w-full overflow-x-clip focus:outline-none ${activeTab === 'map' ? '' : 'pb-20 lg:pb-0'}`}
      >
        <Suspense
          fallback={
            <div
              role="status"
              aria-live="polite"
              className="flex-1 flex items-center justify-center min-h-[50vh] text-xs font-mono text-[#72778A]"
            >
              {language === 'mn' ? 'Ачаалж байна…' : 'Loading view…'}
            </div>
          }
        >
        <div key={activeTab} className="flex-1 flex flex-col animate-fade-in">
            {activeTab === 'citizen' && (
              <CitizenHomePage
                language={language}
                onSelectTab={setActiveTab}
                onExploreMap={(distId) => {
                  if (distId) setSelectedDistrictId(distId);
                  setActiveTab('map');
                }}
                onOpenDemoInfo={() => setIsDataSourcesModalOpen(true)}
              />
            )}

            {activeTab === 'landing' && (
              <div className="flex-1 flex flex-col">
                <LandingHero
                  language={language}
                  audience={audience}
                  onSelectAudience={handleSelectAudience}
                  onExploreMap={() => setActiveTab('map')}
                  onSelectTab={setActiveTab}
                  onOpenDemoInfo={() => setIsDataSourcesModalOpen(true)}
                  onOpenFamilyMode={() => setIsFamilyModeOpen(true)}
                />
                <LandingSections
                  language={language}
                  onSelectTab={setActiveTab}
                  onSelectDistrict={handleSelectDistrictAndDetail}
                  onOpenDemoInfo={() => setIsDataSourcesModalOpen(true)}
                />
              </div>
            )}

            {activeTab === 'overview' && (
              <div className="max-w-[1440px] mx-auto w-full px-2 sm:px-6 py-3 sm:py-5">
                <div className="rounded-[24px] sm:rounded-[32px] overflow-hidden shadow-[0_24px_60px_-15px_rgba(6,10,36,0.42)] border border-black/10 dark:border-white/10 bg-[#F7F8FA]">
                  <OverviewDashboard
                    language={language}
                    viewMode={viewMode}
                    onSelectTab={setActiveTab}
                    onSelectDistrict={handleSelectDistrictAndMap}
                    onOpenDemoInfo={() => setIsDataSourcesModalOpen(true)}
                  />
                </div>
              </div>
            )}

            {activeTab === 'map' && (
              <RiskMap
                language={language}
                viewMode={viewMode}
                selectedDistrictId={selectedDistrictId}
                onSelectDistrict={(id) => setSelectedDistrictId(id)}
                onNavigateToDetail={handleSelectDistrictAndDetail}
              />
            )}

            {activeTab === 'explorer' && (
              <div className="max-w-[1440px] mx-auto w-full px-2 sm:px-6 py-3 sm:py-5">
                <div className="rounded-[24px] sm:rounded-[32px] overflow-hidden shadow-[0_24px_60px_-15px_rgba(6,10,36,0.42)] border border-black/10 dark:border-white/10 bg-[#F7F8FA] space-y-8">
                  <RiskExplorer
                    language={language}
                    onNavigateToMapWithDistrict={handleSelectDistrictAndMap}
                  />
                  <div className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto pb-12">
                    <FireSimulationLab
                      language={language}
                      onExploreMap={() => setActiveTab('map')}
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'districts' && (
              <div className="max-w-[1440px] mx-auto w-full px-2 sm:px-6 py-3 sm:py-5">
                <div className="rounded-[24px] sm:rounded-[32px] overflow-hidden shadow-[0_24px_60px_-15px_rgba(6,10,36,0.42)] border border-black/10 dark:border-white/10 bg-[#F7F8FA]">
                  <DistrictAnalysis
                    language={language}
                    initialDistrictId={selectedDistrictId}
                    onNavigateToMapWithDistrict={handleSelectDistrictAndMap}
                  />
                </div>
              </div>
            )}

            {activeTab === 'incidents' && (
              <div className="max-w-[1440px] mx-auto w-full px-2 sm:px-6 py-3 sm:py-5">
                <div className="rounded-[24px] sm:rounded-[32px] overflow-hidden shadow-[0_24px_60px_-15px_rgba(6,10,36,0.42)] border border-black/10 dark:border-white/10 bg-[#F7F8FA]">
                  <IncidentHistory
                    language={language}
                    onNavigateToMapWithDistrict={handleSelectDistrictAndMap}
                    onOpenDemoInfo={() => setIsDataSourcesModalOpen(true)}
                  />
                </div>
              </div>
            )}

            {activeTab === 'emergency' && (
              <div className="max-w-[1440px] mx-auto w-full px-2 sm:px-6 py-3 sm:py-5">
                <div className="rounded-[24px] sm:rounded-[32px] overflow-hidden shadow-[0_24px_60px_-15px_rgba(6,10,36,0.42)] border border-black/10 dark:border-white/10 bg-[#F7F8FA]">
                  <EmergencyCoverage
                    language={language}
                    onNavigateToMap={() => setActiveTab('map')}
                  />
                </div>
              </div>
            )}

            {activeTab === 'calendar' && (
              <div className="max-w-[1440px] mx-auto w-full px-2 sm:px-6 py-3 sm:py-5">
                <div className="rounded-[24px] sm:rounded-[32px] overflow-hidden shadow-[0_24px_60px_-15px_rgba(6,10,36,0.42)] border border-black/10 dark:border-white/10 bg-[#F7F8FA]">
                  <RiskCalendar language={language} />
                </div>
              </div>
            )}

            {activeTab === 'weather' && (
              <div className="max-w-[1440px] mx-auto w-full px-2 sm:px-6 py-3 sm:py-5">
                <div className="rounded-[24px] sm:rounded-[32px] overflow-hidden shadow-[0_24px_60px_-15px_rgba(6,10,36,0.42)] border border-black/10 dark:border-white/10 bg-[#F7F8FA] space-y-8">
                  <WeatherModule language={language} />
                  <div className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto pb-12">
                    <FireSimulationLab
                      language={language}
                      onExploreMap={() => setActiveTab('map')}
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'safety' && (
              <div className="max-w-[1440px] mx-auto w-full px-2 sm:px-6 py-3 sm:py-5">
                <div className="rounded-[24px] sm:rounded-[32px] overflow-hidden shadow-[0_24px_60px_-15px_rgba(6,10,36,0.42)] border border-black/10 dark:border-white/10 bg-[#F7F8FA] space-y-8">
                  <SafetyCenter language={language} />
                  <div className="px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto pb-12">
                    <FamilyQuickView
                      language={language}
                      onOpenMap={() => setActiveTab('map')}
                    />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'reports' && (
              <div className="max-w-[1440px] mx-auto w-full px-2 sm:px-6 py-3 sm:py-5">
                <div className="rounded-[24px] sm:rounded-[32px] overflow-hidden shadow-[0_24px_60px_-15px_rgba(6,10,36,0.42)] border border-black/10 dark:border-white/10 bg-[#F7F8FA]">
                  <ReportCenter language={language} />
                </div>
              </div>
            )}

            {activeTab === 'sources' && (
              <div className="p-4 sm:p-8 max-w-5xl mx-auto my-4 sm:my-8 space-y-6">
                <div className="bg-white p-6 sm:p-8 rounded-3xl border border-black/[0.06] shadow-xl space-y-6">
                  <span className="text-xs font-mono font-bold text-[#FF633C] uppercase tracking-wider block">
                    GOVERNANCE &amp; DATA MANAGEMENT
                  </span>
                  <h2 className="font-editorial text-2xl sm:text-3xl font-bold text-[#0B124D]">
                    {language === 'mn' ? 'Өгөгдлийн эх сурвалж ба удирдлага' : 'Data Governance & Management'}
                  </h2>
                  <p className="text-xs sm:text-sm text-[#72778A] leading-relaxed">
                    {language === 'mn'
                      ? 'Open-Meteo бодит цаг агаарын мэдээ, багцлагдсан жишээ/загварчилсан орон зайн суурь өгөгдөл болон 6 хүчин зүйлт эвристик загварын ил тод байдал (албан ёсны ОБЕГ/ҮСХ-ны шууд API биш).'
                      : 'Transparency ledger separating live Open-Meteo feeds from bundled demo/modelled reference datasets and the 6-factor heuristic MCDA model (not a live NEMA/NSO feed).'}
                  </p>
                  <button
                    onClick={() => setIsDataSourcesModalOpen(true)}
                    className="px-6 py-3 bg-[#0B124D] hover:bg-[#11166B] text-white text-xs font-bold rounded-2xl transition-all shadow-md active:scale-95"
                  >
                    {language === 'mn' ? 'Эх сурвалжийн самбар нээх' : 'Open Data Governance Panel'}
                  </button>
                  <div className="pt-4 border-t border-black/[0.06]">
                    <AdminDataGate language={language} />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'personal' && (
              <div className="max-w-[1440px] mx-auto w-full px-2 sm:px-6 py-3 sm:py-5">
                <div className="rounded-[24px] sm:rounded-[32px] overflow-hidden shadow-[0_24px_60px_-15px_rgba(6,10,36,0.42)] border border-black/10 dark:border-white/10 bg-[#F7F8FA]">
                  <PersonalPortal
                    language={language}
                    onExploreMap={() => setActiveTab('map')}
                    onSelectDistrict={handleSelectDistrictAndMap}
                  />
                </div>
              </div>
            )}

            {activeTab === 'police' && (
              <div className="max-w-[1440px] mx-auto w-full px-2 sm:px-6 py-3 sm:py-5">
                <div className="rounded-[24px] sm:rounded-[32px] overflow-hidden shadow-[0_24px_60px_-15px_rgba(6,10,36,0.42)] border border-black/10 dark:border-white/10 bg-[#F7F8FA]">
                  <PolicePlaceholder
                    language={language}
                    onSelectTab={setActiveTab}
                  />
                </div>
              </div>
            )}
        </div>
        </Suspense>
      </main>

      {/* Footer (Hidden on map view for full screen immersion) */}
      {activeTab !== 'map' && (
        <Footer
          language={language}
          onSelectTab={setActiveTab}
          onOpenSources={() => setIsDataSourcesModalOpen(true)}
          onOpenAbout={() => setIsAboutModalOpen(true)}
        />
      )}

      {/* Mobile Fixed Bottom Navigation Bar (Hidden on Desktop) */}
      <MobileBottomNav
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        language={language}
        audience={audience}
        onOpenMenu={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        isMenuOpen={isMobileMenuOpen}
      />

      {/* Mobile Slide-Over Menu Drawer (mounted lazily when opened) */}
      {isMobileMenuOpen && (
        <Suspense fallback={null}>
          <MobileMenuDrawer
            isOpen={isMobileMenuOpen}
            onClose={closeMobileMenu}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            language={language}
            setLanguage={setLanguage}
            audience={audience}
            onSelectAudience={handleSelectAudience}
            onOpenSources={() => setIsDataSourcesModalOpen(true)}
            onOpenAbout={() => setIsAboutModalOpen(true)}
            onToggleFamilyMode={() => setIsFamilyModeOpen(!isFamilyModeOpen)}
            isFamilyModeOpen={isFamilyModeOpen}
            theme={theme}
            onToggleTheme={toggleTheme}
          />
        </Suspense>
      )}

      {/* Data Governance & Demo Transparency Modal (lazy-loaded on open) */}
      {isDataSourcesModalOpen && (
        <Suspense fallback={null}>
          <DataSourcesModal
            isOpen={isDataSourcesModalOpen}
            onClose={closeSourcesModal}
            language={language}
          />
        </Suspense>
      )}

      {/* About, Privacy & Safety Disclaimers Modal (lazy-loaded on open) */}
      {isAboutModalOpen && (
        <Suspense fallback={null}>
          <AboutModal
            isOpen={isAboutModalOpen}
            onClose={closeAboutModal}
            language={language}
            onOpenSources={() => setIsDataSourcesModalOpen(true)}
          />
        </Suspense>
      )}

      <OfflineIndicator language={language} />

    </div>
  );
}
