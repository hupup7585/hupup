// Pin the Shabbes and Yom Tov lock to a Tuesday, so the suite never depends on the day it runs.
process.env.HUP_CALENDAR_NOW ??= "2026-11-17T17:00:00Z";

// Older wording tests read each menu line as one sentence; the half-second option pauses (Nov 19, 2026) are tested
// on their own in tests/nov19-phone-batch.test.ts
process.env.IVR_OPTION_PAUSES = "off";
