export const ShowState = {
  PAST: 'past',
  TICKETED: 'ticketed',
  WATCHING: 'watching',
} as const;
export type ShowState = (typeof ShowState)[keyof typeof ShowState];
