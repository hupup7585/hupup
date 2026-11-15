// Pin the Shabbos and Yom Tov lock to a Tuesday, so the suite never depends on the day it runs.
process.env.HUP_CALENDAR_NOW ??= "2026-11-17T17:00:00Z";
