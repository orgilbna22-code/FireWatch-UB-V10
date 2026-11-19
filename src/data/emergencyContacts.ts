export const EMERGENCY_DISPATCH = {
  fire: "101",
  rescue: "105",
  police: "102",
  ambulance: "103",
};

export const EMERGENCY_LABELS = {
  fireRescueShort: "101 / 105",
  fireRescueSystem: "Гал түймэр, аврах алба",
};

export const PROJECT_MAINTAINER = {
  leadNameMn: "FireWatch UB баг",
  leadNameEn: "FireWatch UB Team",
  cityMn: "Улаанбаатар",
  cityEn: "Ulaanbaatar",
  pilotPartnerNameMn: "Туршилтын түнш тохируулаагүй",
  pilotPartnerNameEn: "No pilot partner configured",
};

export function getMaintainerEmail(): string {
  return "";
}

export function getMaintainerMailto(
  subject = "FireWatch UB feedback",
  body = ""
): string {
  const email = getMaintainerEmail();
  if (!email) return "#";
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
