import React, { useState } from 'react';
import { Check, Copy, Flag, Mail, ThumbsUp } from 'lucide-react';
import { Language } from '../../types';
import { getMaintainerMailto } from '../../data/emergencyContacts';

interface FeedbackPromptProps {
  language: Language;
  contextArea?: string;
  contextTimestamp?: string;
}

export const FeedbackPrompt: React.FC<FeedbackPromptProps> = ({
  language,
  contextArea = 'Ulaanbaatar',
  contextTimestamp = '',
}) => {
  const isMn = language === 'mn';
  const [helpfulAck, setHelpfulAck] = useState(false);
  const [showReportForm, setShowReportForm] = useState(false);
  const [issueNote, setIssueNote] = useState('');
  const [copied, setCopied] = useState(false);

  const summaryPayload = [
    `FIREWATCH UB — Feedback / Data Correction`,
    `Area: ${contextArea}`,
    contextTimestamp ? `Meteo Timestamp: ${contextTimestamp}` : '',
    `Note: ${issueNote.trim() || '(no additional comment)'}`,
  ]
    .filter(Boolean)
    .join('\n');

  const mailtoHref = getMaintainerMailto(
    isMn
      ? `FireWatch UB — Өгөгдлийн алдаа / санал (${contextArea})`
      : `FireWatch UB — Data Correction (${contextArea})`,
    summaryPayload
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(summaryPayload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      // ignore clipboard restriction errors
    }
  };

  return (
    <div className="pt-3 border-t border-black/[0.06] space-y-2.5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-[#5C6275]">
          {isMn
            ? 'Энэ мэдээлэл ойлгомжтой байсан уу?'
            : 'Was this risk summary helpful and accurate?'}
        </span>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setHelpfulAck(true);
              setShowReportForm(false);
            }}
            aria-pressed={helpfulAck}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-lg border text-xs font-semibold transition-colors ${
              helpfulAck
                ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                : 'bg-white border-black/10 text-[#0B124D] hover:bg-slate-50'
            }`}
          >
            <ThumbsUp className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{helpfulAck ? (isMn ? 'Баярлалаа!' : 'Thank you!') : isMn ? 'Тийм' : 'Helpful'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setShowReportForm((v) => !v);
              setHelpfulAck(false);
            }}
            aria-expanded={showReportForm}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-lg border text-xs font-semibold transition-colors ${
              showReportForm
                ? 'bg-amber-100 border-amber-300 text-amber-950'
                : 'bg-white border-black/10 text-[#5C6275] hover:text-[#0B124D] hover:bg-slate-50'
            }`}
          >
            <Flag className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{isMn ? 'Буруу өгөгдөл мэдээлэх' : 'Report wrong data'}</span>
          </button>
        </div>
      </div>

      {showReportForm && (
        <div className="p-3 rounded-xl bg-[#F7F8FA] border border-black/[0.08] space-y-2">
          <p className="text-xs text-[#5C6275] leading-snug">
            {isMn
              ? 'Хувийн мэдээлэл (утас, нэр) бичих шаардлагагүй. Доорх тайлбарыг хуулж эсвэл имэйлээр илгээнэ үү.'
              : 'Privacy-friendly report: no tracking or server logging. Copy context or send via email.'}
          </p>
          <textarea
            rows={2}
            maxLength={300}
            value={issueNote}
            onChange={(e) => setIssueNote(e.target.value)}
            placeholder={
              isMn
                ? 'Жишээ нь: Манай хорооны гал унтраах ангийн зай эсвэл гэр хорооллын хувь зөрүүтэй байна...'
                : 'Describe what looks inaccurate for this area...'
            }
            aria-label={isMn ? 'Алдааны тайлбар' : 'Data correction note'}
            className="w-full rounded-lg border border-black/15 bg-white px-2.5 py-1.5 text-xs text-[#0B124D] focus:outline-none focus:ring-2 focus:ring-[#FF633C]"
          />
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={mailtoHref}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-lg bg-[#0B124D] hover:bg-[#11166B] text-white text-xs font-bold transition-colors"
            >
              <Mail className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{isMn ? 'Имэйлээр илгээх' : 'Send via Email'}</span>
            </a>
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-lg bg-white border border-black/15 text-[#0B124D] hover:bg-slate-50 text-xs font-bold transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-[#0E7A65]" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? (isMn ? 'Хуулагдлаа' : 'Copied') : isMn ? 'Мэдээлэл хуулах' : 'Copy Details'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
