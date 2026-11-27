/** The browser's time zone id (e.g. "Asia/Kolkata"), or undefined when it can't be told. Sent with a meeting so invitation e-mails can say the time where the organizer is. */
export function browserZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined; } catch { return undefined; }
}
