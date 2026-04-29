export const Kind = {
  CONCERT: 'concert',
  THEATRE: 'theatre',
  COMEDY: 'comedy',
  FESTIVAL: 'festival',
  SPORTS: 'sports',
} as const;
export type Kind = (typeof Kind)[keyof typeof Kind];

export const KIND_COLORS = {
  concert: { light: '#2E6FD9', dark: '#3A86FF' },
  theatre: { light: '#D42F3A', dark: '#E63946' },
  comedy: { light: '#8340C4', dark: '#9D4EDD' },
  festival: { light: '#238577', dark: '#2A9D8F' },
  sports: { light: '#D06A28', dark: '#E8772E' },
} as const;

export const KIND_LABELS = {
  concert: 'Concert',
  theatre: 'Theatre',
  comedy: 'Comedy',
  festival: 'Festival',
  sports: 'Sports',
} as const;
