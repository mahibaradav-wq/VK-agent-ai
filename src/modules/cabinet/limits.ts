export const PERSONAL_ACTIVE_PROJECT_LIMIT = 10;

export const PERSONAL_CABINET_LIMITS = {
  projects: PERSONAL_ACTIVE_PROJECT_LIMIT,
  socialAccounts: 20,
  members: 20,
  postsPerMonth: 500,
} as const;

export type PersonalCabinetLimits = typeof PERSONAL_CABINET_LIMITS;
