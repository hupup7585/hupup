/**
 * Street names, one recording each (Abraham, Nov 22, 2026, 11:12 PM): the 348 streets from the directory list. Hark
 * sends the list; each name gets an Admin slot in the "Streets" group.
 */
export const STREET_NAMES: readonly string[] = [];

export const streetSlotKey = (street: string) => `street:${street.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;
