/**
 * Company details shown in the policy pages and emails. Kept in one place so
 * they change together — a payment provider reviewing the site checks that
 * these are consistent and reachable.
 */
export const COMPANY_NAME = "MotorWise";
export const SUPPORT_EMAIL =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@motorwise.co";
export const COMPANY_LOCATION = "Cameroon";
