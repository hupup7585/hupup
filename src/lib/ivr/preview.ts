/**
 * Admin "Test this screen" (Admin handoff Phase 3, section 6, Nov 26, 2026): a preview runs a phone step with a call id
 * that starts with PREVIEW-. Such a call never creates a call session, never writes the call journey and never shows
 * in the call log or the dashboard.
 */
export const PREVIEW_PREFIX = "PREVIEW-";
export const isPreviewCall = (callSid: string | null | undefined) => Boolean(callSid?.startsWith(PREVIEW_PREFIX));
