import React, { Suspense, lazy, useCallback, useState, useEffect } from 'react';
import { ActiveTab, Language, ViewMode } from './types';
import { Header } from './components/common/Header';
import { Footer } from './components/common/Footer';
import { LandingHero } from './components/landing/LandingHero';
import { LandingSections } from './components/landing/LandingSections';
import { DataSourcesModal } from './components/common/DataSourcesModal';
import { AboutModal } from './components/common/AboutModal';
import { FamilyQuickView } from './components/common/FamilyQuickView';
import { GlobalFireBackground } from './components/common/GlobalFireBackground';
import { MobileBottomNav } from './components/common/MobileBottomNav';
import { MobileMenuDrawer } from './components/common/MobileMenuDrawer';
import { OfflineIndicator } from './components/common/PWAStatus';
import { useTheme } from './hooks/useTheme';
import { liveWeather } from './hooks/liveWeather';
import { useApiAvailability } from './utils/apiClient';
import { AudienceRole, readSavedAudience, saveAudience } from './utils/audienceSession';

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
  'landing', 'overview', 'map', 'explorer', 'districts', 'incidents',
  'calendar', 'emergency', 'weather', 'safety', 'reports', 'sources', 'personal', 'police',
];

function getInitialTab(): ActiveTab {
  const h = window.location.hash.replace('#', '') as ActiveTab;
  return VALID_TABS.includes(h) ? h : 'landing';
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
  const { theme, toggleTheme } = useTheme();
  const apiHealth = useApiAvailability(language);

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
      const h = window.location.hash.replace('#', '') as ActiveTab;
      if (VALID_TABS.includes(h)) {
        setActiveTab((cur) => (cur === h ? cur : h));
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
    <div className="min-h-screen flex flex-col bg-[#F7F8FA] text-[#12152A] antialiased selection:bg-[#FF633C]/20 selection:text-[#0B124D] relative w-full max-w-full overflow-x-hidden">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[1500] focus:px-4 focus:py-2 focus:rounded-xl focus:bg-[#0B124D] focus:text-white focus:text-xs focus:font-bold focus:shadow-lg"
      >
        {language === 'mn' ? 'Үндсэн хэсэг рүү очих' : 'Skip to main content'}
      </a>

      {/* Omnipresent Living Ambient Fire Atmosphere Across Whole Site */}
      <GlobalFireBackground initialMode="soft" language={language} hideRibbon={activeTab === 'map'} />

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

      {/* Optional Family & Elder Friendly Quick Modal Overlay */}
      {isFamilyModeOpen && (
        <FamilyQuickView
          language={language}
          onClose={closeFamilyMode}
          onOpenMap={() => {
            setIsFamilyModeOpen(false);
            setActiveTab('map');
          }}
        />
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
            className="px-2.5 py-0.5 rounded-lg bg-white border border-amber-300 text-[11px] font-bold text-amber-900 hover:bg-amber-100"
          >
            {language === 'mn' ? 'Дахин шалгах' : 'Retry'}
          </button>
          <button
            type="button"
            onClick={() => setDemoNoticeDismissed(true)}
            aria-label={language === 'mn' ? 'Хаах' : 'Dismiss'}
            className="text-amber-800 hover:text-amber-950 font-bold px-1"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main View Router with Apple-Grade Smooth Transition & Code Splitting */}
      <main
        id="main-content"
        tabIndex={-1}
        className={`flex-1 flex flex-col relative w-full max-w-full overflow-x-hidden focus:outline-none ${activeTab === 'map' ? '' : 'pb-20 lg:pb-0'}`}
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
              <OverviewDashboard
                language={language}
                viewMode={viewMode}
                onSelectTab={setActiveTab}
                onSelectDistrict={handleSelectDistrictAndMap}
                onOpenDemoInfo={() => setIsDataSourcesModalOpen(true)}
              />
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
              <div className="space-y-8">
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
            )}

            {activeTab === 'districts' && (
              <DistrictAnalysis
                language={language}
                initialDistrictId={selectedDistrictId}
                onNavigateToMapWithDistrict={handleSelectDistrictAndMap}
              />
            )}

            {activeTab === 'incidents' && (
              <IncidentHistory
                language={language}
                onNavigateToMapWithDistrict={handleSelectDistrictAndMap}
                onOpenDemoInfo={() => setIsDataSourcesModalOpen(true)}
              />
            )}

            {activeTab === 'emergency' && (
              <EmergencyCoverage
                language={language}
                onNavigateToMap={() => setActiveTab('map')}
              />
            )}

            {activeTab === 'calendar' && (
              <RiskCalendar language={language} />
            )}

            {activeTab === 'weather' && (
              <div className="space-y-8">
                <WeatherModule language={language} />
                <div className="px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto pb-12">
                  <FireSimulationLab
                    language={language}
                    onExploreMap={() => setActiveTab('map')}
                  />
                </div>
              </div>
            )}

            {activeTab === 'safety' && (
              <div className="space-y-8">
                <SafetyCenter language={language} />
                <div className="px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto pb-12">
                  <FamilyQuickView
                    language={language}
                    onOpenMap={() => setActiveTab('map')}
                  />
                </div>
              </div>
            )}

            {activeTab === 'reports' && (
              <ReportCenter language={language} />
            )}

            {activeTab === 'sources' && (
              <div className="p-4 sm:p-8 max-w-5xl mx-auto my-4 sm:my-8 space-y-6">
                <div className="bg-white/90 backdrop-blur-xl p-6 sm:p-8 rounded-3xl border border-black/[0.06] shadow-sm space-y-6">
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
              <PersonalPortal
                language={language}
                onExploreMap={() => setActiveTab('map')}
                onSelectDistrict={handleSelectDistrictAndMap}
              />
            )}

            {activeTab === 'police' && (
              <PolicePlaceholder
                language={language}
                onSelectTab={setActiveTab}
              />
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

      {/* Mobile Slide-Over Menu Drawer */}
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

      {/* Data Governance & Demo Transparency Modal */}
      <DataSourcesModal
        isOpen={isDataSourcesModalOpen}
        onClose={closeSourcesModal}
        language={language}
      />

      {/* About, Privacy & Safety Disclaimers Modal */}
      <AboutModal
        isOpen={isAboutModalOpen}
        onClose={closeAboutModal}
        language={language}
        onOpenSources={() => setIsDataSourcesModalOpen(true)}
      />

      <OfflineIndicator language={language} />

    </div>
  );
}
