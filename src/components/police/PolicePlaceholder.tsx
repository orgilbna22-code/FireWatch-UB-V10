import React from 'react';
import { ActiveTab, Language } from '../../types';
import { EMERGENCY_DISPATCH, getMaintainerMailto } from '../../data/emergencyContacts';

interface PolicePlaceholderProps {
  language: Language;
  onSelectTab: (tab: ActiveTab) => void;
}

export const PolicePlaceholder: React.FC<PolicePlaceholderProps> = ({
  language,
  onSelectTab,
}) => {
  const isMn = language === 'mn';
  const feedbackMailto = getMaintainerMailto(
    isMn
      ? 'FireWatch UB — Цагдаагийн хэрэгцээ шаардлага тодорхойлох'
      : 'FireWatch UB — Police Workflow Inquiry'
  );

  return (
    <div className="w-full min-h-[calc(100vh-65px)] bg-[#F7F8FA] p-4 sm:p-8 flex items-center justify-center">
      <div className="max-w-2xl w-full bg-white rounded-3xl border border-black/[0.08] shadow-sm p-6 sm:p-10 space-y-6">
        <div className="space-y-2">
          <span className="inline-block px-3 py-1 rounded-full bg-[#0B124D]/8 text-[#0B124D] font-mono text-xs font-bold uppercase tracking-wider">
            {isMn ? 'ТҮР ХУУДАС · ХЭРЭГЦЭЭ БАТЛАГДААГҮЙ' : 'PLACEHOLDER · REQUIREMENTS UNCONFIRMED'}
          </span>
          <h1 className="font-editorial text-2xl sm:text-3xl font-bold text-[#0B124D]">
            {isMn
              ? 'Цагдаагийн албан хаагчдад зориулсан хэсэг'
              : 'Police Coordination View'}
          </h1>
          <p className="text-sm text-[#5C6275] leading-relaxed">
            {isMn
              ? 'Цагдаагийн байгууллагын гал түймрийн үеийн зам чөлөөлөлт, хамгаалалтын бүс эсвэл тайлангийн бодит ажлын урсгал хараахан баталгаажаагүй байна. Тиймээс бид зохиомол функц нэмээгүй болно.'
              : 'Operational workflows for police units during fire incidents (e.g., perimeter control, traffic diversion, or dispatch handoff) have not yet been confirmed with agency stakeholders. No speculative features have been invented here.'}
          </p>
        </div>

        <div className="rounded-2xl bg-[#F7F8FA] border border-black/[0.06] p-4 space-y-2 text-xs text-[#12152A]">
          <div className="font-bold text-[#0B124D]">
            {isMn ? 'Шуурхай холбоо ба үүргийн утас' : 'Verified Emergency Dispatch Numbers'}
          </div>
          <div className="flex flex-wrap gap-2.5 pt-1">
            <a
              href={`tel:${EMERGENCY_DISPATCH.police}`}
              className="px-3.5 py-2.5 rounded-xl bg-[#0B124D] text-white font-mono font-bold hover:bg-[#11166B] transition-colors min-h-[44px] inline-flex items-center"
            >
              🚓 {EMERGENCY_DISPATCH.police} — {isMn ? 'Цагдаа' : 'Police'}
            </a>
            <a
              href={`tel:${EMERGENCY_DISPATCH.rescue}`}
              className="px-3.5 py-2.5 rounded-xl bg-[#E93B2F] text-white font-mono font-bold hover:bg-[#c82d22] transition-colors min-h-[44px] inline-flex items-center"
            >
              🚒 {EMERGENCY_DISPATCH.rescue} — {isMn ? 'Онцгой байдал' : 'Fire & Rescue'}
            </a>
            <a
              href={`tel:${EMERGENCY_DISPATCH.fire}`}
              className="px-3.5 py-2.5 rounded-xl bg-white border border-black/15 text-[#0B124D] font-mono font-bold hover:bg-slate-100 transition-colors min-h-[44px] inline-flex items-center"
            >
              {EMERGENCY_DISPATCH.fire} — {isMn ? 'Гал команд' : 'Fire Desk'}
            </a>
          </div>
        </div>

        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-xs text-amber-950 space-y-1.5">
          <div className="font-bold">
            {isMn ? 'Баталгаажуулах шаардлагатай нээлттэй асуултууд' : 'Open Questions Pending Confirmation'}
          </div>
          <p className="leading-relaxed">
            {isMn
              ? 'Шалган нэвтрүүлэх цэг, хамгаалалтын радиус, эсвэл 102–105 мэдээлэл солилцооны ямар үзүүлэлт шаардлагатайг төслийн docs/OPEN_QUESTIONS.md баримтаар бүртгэсэн.'
              : 'Specific perimeter radii, traffic-blocking criteria, and 102–105 handoff needs are documented as open questions in docs/OPEN_QUESTIONS.md pending stakeholder input.'}
          </p>
          <a
            href={feedbackMailto}
            className="inline-flex items-center font-bold underline text-amber-900 hover:text-[#0B124D] min-h-[44px]"
          >
            {isMn ? 'Хэрэгцээ шаардлага санал болгох (имэйл) →' : 'Share workflow requirements via email →'}
          </a>
        </div>

        <div className="flex flex-wrap gap-3 pt-2">
          <button
            type="button"
            onClick={() => onSelectTab('map')}
            className="px-5 py-2.5 rounded-xl bg-[#0B124D] text-white text-xs font-bold hover:bg-[#11166B] transition-colors min-h-[44px]"
          >
            {isMn ? 'Үндсэн газрын зураг руу очих →' : 'Open Core Risk Map →'}
          </button>
          <button
            type="button"
            onClick={() => onSelectTab('landing')}
            className="px-5 py-2.5 rounded-xl bg-white border border-black/15 text-[#0B124D] text-xs font-bold hover:bg-slate-50 transition-colors min-h-[44px]"
          >
            {isMn ? '← Нүүр хуудас руу буцах' : '← Back to Landing'}
          </button>
        </div>
      </div>
    </div>
  );
};
