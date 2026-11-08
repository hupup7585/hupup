/**
 * Whole rental days (Abraham, Nov 8, 2026): no start or end times. Delivery is between 9:00 AM and 12:00 PM (usually
 * done by 11:00 AM); the customer puts the rental outside the door by 9:00 AM on the pickup day. No pickup on Shabbos
 * or Yom Tov: the pickup day is the next open day (Friday delivery -> Sunday pickup).
 */
export const DELIVERY_WINDOW = "9:00 AM – 12:00 PM";
export const PICKUP_BY = "9:00 AM";
