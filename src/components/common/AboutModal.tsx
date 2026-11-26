import React from 'react';
import { Language } from '../../types';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import {
  EMERGENCY_DISPATCH,
  PROJECT_MAINTAINER,
  getMaintainerEmail,
  getMaintainerMailto,
} from '../../data/emergencyContacts';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
  language: Language;
  onOpenSources?: () => void;
}

export const AboutModal: React.FC<AboutModalProps> = ({
  isOpen,
  onClose,
  language,
  onOpenSources,
}) => {
  const isMn = language === 'mn';
  useEscapeKey(isOpen, onClose);

  if (!isOpen) return null;

  const bugReportHref = getMaintainerMailto(
    isMn ? 'FireWatch UB — Өгөгдлийн алдаа мэдээлэх' : 'FireWatch UB — Data Correction Report',
    isMn
      ? 'Дүүрэг / Хороо:\nАжиглагдсан зөрүү:\nСанал болгож буй зөв мэдээлэл:'
      : 'District / Khoroo:\nObserved discrepancy:\nSuggested correction:'
  );

  return (
    <div
      className="fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-[#0B124D]/60 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label={isMn ? 'Төслийн тухай ба хариуцлагын мэдэгдэл' : 'About FireWatch UB and disclaimers'}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-3xl max-w-2xl w-full p-6 sm:p-8 shadow-2xl border border-[#0B124D]/10 max-h-[90vh] flex flex-col overflow-hidden animate-pop-in">
        <div className="flex items-center justify-between pb-4 border-b border-[#0B124D]/10">
          <div>
            <span className="text-xs font-mono font-bold tracking-widest text-[#FF633C] uppercase block mb-0.5">
              FIREWATCH UB · TRUST &amp; GOVERNANCE
            </span>
            <h3 className="font-editorial text-2xl font-bold text-[#0B124D]">
              {isMn ? 'Төслийн тухай ба анхааруулга' : 'About, Privacy & Disclaimers'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={isMn ? 'Хаах' : 'Close'}
            className="w-11 h-11 rounded-full bg-[#F7F8FA] hover:bg-slate-200 text-[#5C6275] hover:text-[#0B124D] flex items-center justify-center font-bold"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-4 space-y-4 text-xs text-[#4B5563] leading-relaxed">
          <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-950 space-y-2">
            <div className="font-bold text-sm flex items-center justify-between gap-2 flex-wrap">
              <span>⚠️ {isMn ? 'Албан ёсны зарлан мэдээлэх систем биш' : 'Not an Official Emergency System'}</span>
              <span className="flex items-center gap-2 font-mono text-xs">
                <a
                  href={`tel:${EMERGENCY_DISPATCH.fire}`}
                  className="px-2.5 py-1 rounded-lg bg-[#E93B2F] text-white font-bold hover:bg-red-700"
                >
                  ☎ {EMERGENCY_DISPATCH.fire}
                </a>
                <a
                  href={`tel:${EMERGENCY_DISPATCH.rescue}`}
                  className="px-2.5 py-1 rounded-lg bg-[#0B124D] text-white font-bold hover:bg-[#11166B]"
                >
                  ☎ {EMERGENCY_DISPATCH.rescue}
                </a>
              </span>
            </div>
            <p>
              {isMn
                ? 'FIREWATCH UB нь иргэдэд зориулсан бие даасан судалгаа, урьдчилан сэргийлэх мэдээллийн загвар юм. Бодит гал түймэр, утаа, ослын үед заавал 101 эсвэл 105 руу шууд залгана уу.'
                : 'FIREWATCH UB is an independent research & civic awareness prototype. In any real fire, smoke event, or life-safety emergency, immediately dial 101 or 105.'}
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-[#F7F8FA] border border-[#0B124D]/8 space-y-2">
            <span className="font-bold text-[#0B124D] block text-sm">
              {isMn ? 'Хөгжүүлэлт ба зохиогчид' : 'Project Team & Maintenance'}
            </span>
            <p>
              {isMn
                ? `Хөгжүүлэгч: ${PROJECT_MAINTAINER.leadNameMn} (${PROJECT_MAINTAINER.cityMn}). Улаанбаатарын гэр хороолол болон орон сууцны бүсийн галын эрсдэлийн ойлголтыг нэмэгдүүлэх зорилготой нээлттэй бүтэцтэй төсөл.`
                : `Maintained by ${PROJECT_MAINTAINER.leadNameEn} (${PROJECT_MAINTAINER.cityEn}). Open civic-tech architecture focused on understandable residential fire risk awareness in Ulaanbaatar.`}
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1 font-mono text-xs">
              <a
                href={`mailto:${getMaintainerEmail()}`}
                className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-[#0B124D] font-bold hover:border-[#FF633C]"
              >
                ✉️ {getMaintainerEmail()}
              </a>
              <a
                href={bugReportHref}
                className="px-3 py-1.5 rounded-xl bg-[#FF633C] text-white font-bold hover:bg-[#e05430]"
              >
                🛠️ {isMn ? 'Буруу өгөгдөл мэдээлэх' : 'Report wrong data'}
              </a>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-[#F7F8FA] border border-[#0B124D]/8 space-y-1.5">
            <span className="font-bold text-[#0B124D] block text-sm">
              {isMn ? 'Нууцлал ба өгөгдөл хадгалалт' : 'Privacy & Browser Data'}
            </span>
            <p>
              {isMn
                ? 'Бид гуравдагч талын мөрдөгч (tracking pixel), зар сурталчилгааны cookie ашигладаггүй. Хувийн гэрийн үнэлгээ нь зөвхөн таны санамсаргүй httpOnly сешн (fw_sid) эсвэл таны хөтөч дээр тусгаарлагдан хадгалагдана; утасны дугаарыг серверт хадгалахгүй.'
                : 'No third-party analytics trackers or ad cookies are used. Saved home audits are strictly isolated per anonymous httpOnly session cookie (fw_sid) or browser-only local storage; phone numbers are never sent to or stored on the server.'}
            </p>
          </div>
        </div>

        <div className="pt-4 border-t border-[#0B124D]/10 flex items-center justify-between gap-2">
          {onOpenSources ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenSources();
              }}
              className="text-xs font-mono font-bold text-[#0B124D] hover:text-[#FF633C] underline"
            >
              {isMn ? 'Өгөгдлийн эх сурвалж ба арга зүй →' : 'View Sources & Methodology →'}
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-[#0B124D] text-white rounded-xl text-xs font-bold hover:bg-[#11166B]"
          >
            {isMn ? 'Хаах' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
};
