export interface AiExplanationPayload {
  summary: string;
  verifiedFactors: string[];
  weatherInfluence: string;
  dataLimitations: string;
  actionableSteps: string[];
}

export interface GroundingVerificationContext {
  language: 'mn' | 'en';
  areaName: string;
  riskScore: number;
  isModelled: boolean;
  weatherObservedAtIso?: string | null;
}

export interface GroundingVerificationResult {
  ok: boolean;
  payload: AiExplanationPayload & {
    verifiedGrounding: boolean;
    groundingWarnings: string[];
  };
}

const PROBABILITY_HALLUCINATION_RE =
  /(\b\d{1,3}(?:\.\d+)?\s*%\s*(?:probability|chance|likelihood|odds)\b|\b(?:probability|chance)\s+(?:of|is)\s+\d{1,3}(?:\.\d+)?\s*%|\b\d{1,3}(?:\.\d+)?\s*%-?(?:ийн)?\s*(?:магадлал|магадлалтай)\b)/gi;

function cleanStringArray(val: unknown, fallbackItem: string): string[] {
  if (!Array.isArray(val)) return [fallbackItem];
  const out = val
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim().slice(0, 320))
    .slice(0, 5);
  return out.length > 0 ? out : [fallbackItem];
}

function scrubProbabilityClaim(text: string, lang: 'mn' | 'en', warnings: string[]): string {
  if (!PROBABILITY_HALLUCINATION_RE.test(text)) {
    return text;
  }
  PROBABILITY_HALLUCINATION_RE.lastIndex = 0;
  warnings.push('stripped_ungrounded_probability_claim');
  return text.replace(
    PROBABILITY_HALLUCINATION_RE,
    lang === 'mn' ? '[харьцуулсан эрсдэлийн индекс]' : '[heuristic risk index]'
  );
}

/**
 * Validates and sanitizes Gemini structured JSON output against the supplied area/weather context
 * so missing fields never leak undefined values and hallucinated ignition probabilities (%) are caught.
 */
export function verifyAiExplanationGrounding(
  rawParsed: Record<string, unknown>,
  ctx: GroundingVerificationContext
): GroundingVerificationResult {
  const warnings: string[] = [];
  const isMn = ctx.language === 'mn';

  let summary =
    typeof rawParsed.summary === 'string' && rawParsed.summary.trim()
      ? rawParsed.summary.trim().slice(0, 900)
      : isMn
        ? `${ctx.areaName} бүсийн эвристик галын эрсдэлийн индекс ${ctx.riskScore}/100 байна.`
        : `${ctx.areaName} carries a composite heuristic fire-risk index of ${ctx.riskScore}/100.`;
  if (!(typeof rawParsed.summary === 'string' && rawParsed.summary.trim())) {
    warnings.push('missing_summary_fallback');
  }

  let weatherInfluence =
    typeof rawParsed.weatherInfluence === 'string' && rawParsed.weatherInfluence.trim()
      ? rawParsed.weatherInfluence.trim().slice(0, 700)
      : ctx.weatherObservedAtIso
        ? isMn
          ? `Цаг агаарын ажиглалт (${ctx.weatherObservedAtIso}) нь гал асах мэдрэмж болон салхины тархалтын боломжийг ялган харуулна.`
          : `Weather observation (${ctx.weatherObservedAtIso}) distinguishes ignition receptivity from wind-driven spread potential.`
        : isMn
          ? 'Шууд цаг агаарын ажиглалт одоогоор боломжгүй байна.'
          : 'Live weather observation is currently unavailable.';
  if (!(typeof rawParsed.weatherInfluence === 'string' && rawParsed.weatherInfluence.trim())) {
    warnings.push('missing_weather_influence_fallback');
  }

  let dataLimitations =
    typeof rawParsed.dataLimitations === 'string' && rawParsed.dataLimitations.trim()
      ? rawParsed.dataLimitations.trim().slice(0, 700)
      : isMn
        ? `Энэ үнэлгээ нь эвристик индекс бөгөөд албан ёсны гал түймрийн магадлал (%) эсвэл диспетчерийн мэдэгдэл биш${ctx.isModelled ? ' (загварчилсан хороо багтсан)' : ''}.`
        : `This assessment is a composite heuristic index—not a statistical ignition probability (%) or official dispatch alert${ctx.isModelled ? ' (includes modelled khoroo data)' : ''}.`;
  if (!(typeof rawParsed.dataLimitations === 'string' && rawParsed.dataLimitations.trim())) {
    warnings.push('missing_data_limitations_fallback');
  }

  summary = scrubProbabilityClaim(summary, ctx.language, warnings);
  weatherInfluence = scrubProbabilityClaim(weatherInfluence, ctx.language, warnings);
  dataLimitations = scrubProbabilityClaim(dataLimitations, ctx.language, warnings);

  const verifiedFactors = cleanStringArray(
    rawParsed.verifiedFactors,
    isMn
      ? `Нийлмэл эрсдэлийн индекс: ${ctx.riskScore}/100`
      : `Composite heuristic index: ${ctx.riskScore}/100`
  ).map((line) => scrubProbabilityClaim(line, ctx.language, warnings));

  const actionableSteps = cleanStringArray(
    rawParsed.actionableSteps,
    isMn
      ? 'Утаа мэдрэгч, галын хор болон цахилгаан залгуурын ачааллыг шалгах.'
      : 'Verify smoke detector battery, extinguisher access, and electrical outlet load.'
  );

  // Guarantee explicit heuristic-index disclaimer appears when area score is high or probability claim was scrubbed
  if (warnings.includes('stripped_ungrounded_probability_claim')) {
    const addendum = isMn
      ? ' Анхаар: 0–100 оноо нь статистик магадлалын хувь биш.'
      : ' Note: 0–100 score is a heuristic index, not a statistical probability.';
    if (!dataLimitations.includes('магадлал') && !dataLimitations.toLowerCase().includes('probability')) {
      dataLimitations = `${dataLimitations}${addendum}`;
    }
  }

  return {
    ok: warnings.length === 0,
    payload: {
      summary,
      verifiedFactors,
      weatherInfluence,
      dataLimitations,
      actionableSteps,
      verifiedGrounding: true,
      groundingWarnings: warnings,
    },
  };
}
