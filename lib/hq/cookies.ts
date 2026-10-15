/*
 * Cookie names for Planted HQ. Kept apart from the parked Tidewell app's cookies so the
 * two sign-in flows never read each other's state.
 */

/**
 * The address waiting for a sign-in code, between /hq/sign-in and /hq/verify. HttpOnly,
 * scoped to /hq, ten minutes. It never appears in a URL.
 */
export const HQ_OTP_EMAIL_COOKIE = "hq-otp-email";

/** Lifetime of that cookie in seconds: the same ten minutes the code itself lasts. */
export const HQ_OTP_EMAIL_TTL_S = 10 * 60;
