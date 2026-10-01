// « Aujourd'hui » et « cette semaine » s'entendent à l'heure de l'équipe, pas du serveur (UTC).
export const CRM_TIMEZONE = process.env.CRM_TIMEZONE?.trim() || "Europe/Paris";

function offsetMs(date: Date, timeZone: string) {
  const local = new Date(date.toLocaleString("en-US", { timeZone }));
  const utc = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
  return local.getTime() - utc.getTime();
}

function localDateParts(date: Date, timeZone: string) {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .split("-")
    .map(Number);
  return { y, m, d };
}

/** Minuit (heure locale) du jour y/m/d, décalé de `addDays` jours. */
function localMidnight(y: number, m: number, d: number, addDays: number, timeZone: string) {
  const noonUtc = new Date(Date.UTC(y, m - 1, d + addDays, 12));
  return new Date(Date.UTC(y, m - 1, d + addDays) - offsetMs(noonUtc, timeZone));
}

export function dayBounds(now = new Date(), timeZone = CRM_TIMEZONE) {
  const { y, m, d } = localDateParts(now, timeZone);
  const start = localMidnight(y, m, d, 0, timeZone);
  const end = new Date(localMidnight(y, m, d, 1, timeZone).getTime() - 1);
  return { start, end, isoDate: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
}

/** Fin du dimanche de la semaine en cours (heure locale). */
export function endOfWeek(now = new Date(), timeZone = CRM_TIMEZONE) {
  const { y, m, d } = localDateParts(now, timeZone);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = dimanche
  const daysToSunday = (7 - weekday) % 7;
  return new Date(localMidnight(y, m, d, daysToSunday + 1, timeZone).getTime() - 1);
}

export const DUE_FILTERS = ["today", "overdue", "week"] as const;
export type DueFilter = (typeof DUE_FILTERS)[number];

export function isDueFilter(value: unknown): value is DueFilter {
  return typeof value === "string" && (DUE_FILTERS as readonly string[]).includes(value);
}
