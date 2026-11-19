import React, { useState } from 'react';
import { Download, WifiOff, X } from 'lucide-react';
import { Language } from '../../types';
import { useOnlineStatus, usePWAInstall } from '../../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  language: Language;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ language }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-[#FF633C] text-white text-[11px] font-mono font-bold transition-colors border border-white/15"
      >
        <Download className="w-3.5 h-3.5" aria-hidden="true" />
        {language === 'mn' ? 'Апп суулгах' : 'Install App'}
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[11px] font-mono font-bold transition-colors border border-white/15"
        >
          <Download className="w-3.5 h-3.5" aria-hidden="true" />
          {language === 'mn' ? 'iPhone дээр суулгах' : 'Install on iOS'}
        </button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-[1300] flex items-center justify-center bg-[#0B124D]/75 p-4 backdrop-blur-xs"
            role="dialog"
            aria-modal="true"
            aria-label={language === 'mn' ? 'iPhone дээр суулгах заавар' : 'Install on iPhone / iPad'}
          >
            <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-[#0B124D] shadow-2xl space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-sm">
                  {language === 'mn' ? 'Дэлгэцэнд нэмэх (iOS Safari)' : 'Add to Home Screen (iOS Safari)'}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label={language === 'mn' ? 'Хаах' : 'Close'}
                  className="p-1 rounded-full hover:bg-slate-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-[#4A5068] leading-relaxed">
                {language === 'mn'
                  ? '1. Safari хөтчийн доод хэсгийн Share товчийг дарна уу. 2. "Add to Home Screen" сонголтыг дарна уу.'
                  : '1. Tap the Share button in Safari. 2. Scroll down and tap Add to Home Screen.'}
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full py-2 rounded-xl bg-[#0B124D] text-white text-xs font-bold"
              >
                {language === 'mn' ? 'Ойлголоо' : 'Got it'}
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineIndicator: React.FC<{ language: Language }> = ({ language }) => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-20 sm:bottom-4 left-4 z-[950] flex items-center gap-2 rounded-xl bg-[#0B124D] border border-[#FF633C]/50 px-3.5 py-2 text-xs font-mono text-white shadow-lg"
    >
      <WifiOff className="w-3.5 h-3.5 text-[#FF633C]" aria-hidden="true" />
      <span>
        {language === 'mn'
          ? 'Офлайн горим — Кэшилсэн дэлгэц ашиглагдаж байна'
          : 'Offline mode — Serving cached app shell'}
      </span>
    </div>
  );
};
