export const EMERGENCY_DISPATCH = {
  fire: '101',
  police: '102',
  ambulance: '103',
  rescue: '105',
} as const;

export const EMERGENCY_LABELS = {
  fireRescueShort: '101 / 105',
} as const;

export const PROJECT_MAINTAINER = {
  leadNameMn: 'Түмэнхүслэн (Бие даасан иргэний технологийн баг)',
  leadNameEn: 'TumenHuslen (Independent Civic-Tech Team)',
  cityMn: 'Улаанбаатар хот, Монгол Улс',
  cityEn: 'Ulaanbaatar, Mongolia',
  email: 'orgilbna22@gmail.com',
  pilotPartnerNameMn: 'Тохируулах боломжтой (Туршилтын түнш бүртгээгүй)',
  pilotPartnerNameEn: 'Configurable (No pilot partner assigned)',
} as const;

export function getMaintainerEmail(): string {
  const override =
    typeof import.meta !== 'undefined' &&
    typeof import.meta.env !== 'undefined' &&
    typeof import.meta.env.VITE_MAINTAINER_EMAIL === 'string'
      ? import.meta.env.VITE_MAINTAINER_EMAIL.trim()
      : '';
  return override || PROJECT_MAINTAINER.email;
}

export function getMaintainerMailto(subject: string, body?: string): string {
  const params = new URLSearchParams();
  if (subject) params.set('subject', subject);
  if (body) params.set('body', body);
  const query = params.toString();
  return `mailto:${getMaintainerEmail()}${query ? `?${query}` : ''}`;
}
