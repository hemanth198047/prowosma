/**
 * Central date formatting utility.
 * Reads timezone and dateFormat from the active workspace stored in sessionStorage.
 * Falls back to browser locale if not set.
 */

function getWorkspaceSettings() {
  try {
    // Try all tab keys in sessionStorage
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && key.includes('activeWorkspace')) {
        const ws = JSON.parse(sessionStorage.getItem(key));
        if (ws) return { timezone: ws.timezone || 'UTC', dateFormat: ws.dateFormat || 'DD/MM/YYYY' };
      }
    }
  } catch { /* Intl API unsupported/failed — fall through to hardcoded default below */ }
  return { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, dateFormat: 'DD/MM/YYYY' };
}

/**
 * Format a date value using the workspace timezone and date format.
 * @param {string|Date} value - ISO string or Date object
 * @param {boolean} showTime - whether to include time
 * @returns {string}
 */
export function formatDate(value, showTime = false) {
  if (!value) return '';
  try {
    const date = new Date(value);
    if (isNaN(date)) return '';
    const { timezone, dateFormat } = getWorkspaceSettings();

    // Get date parts in workspace timezone
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      ...(showTime ? { hour: '2-digit', minute: '2-digit', hour12: true } : {}),
    }).formatToParts(date);

    const get = (type) => parts.find(p => p.type === type)?.value || '';
    const day   = get('day');
    const month = get('month');
    const year  = get('year');
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const monthNum = parseInt(month, 10);
    const monthAbbr = MONTHS[monthNum - 1] || month;

    let datePart = dateFormat
      .replace('DD', day)
      .replace('MM', month)
      .replace('YYYY', year)
      .replace('MMM', monthAbbr);

    if (showTime) {
      const hour   = get('hour');
      const minute = get('minute');
      const dayPeriod = get('dayPeriod'); // AM or PM
      datePart += ` ${hour}:${minute} ${dayPeriod}`;
    }

    return datePart;
  } catch {
    return new Date(value).toLocaleDateString();
  }
}

/**
 * Format only the time portion with AM/PM in workspace timezone.
 */
export function formatTime(value) {
  if (!value) return '';
  try {
    const date = new Date(value);
    if (isNaN(date)) return '';
    const { timezone } = getWorkspaceSettings();
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit', minute: '2-digit', hour12: true,
    }).format(date);
  } catch {
    return '';
  }
}

/**
 * Convert a local datetime string (YYYY-MM-DDTHH:mm) to ISO UTC string
 * treating the input as being in the workspace timezone.
 */
export function localToISO(localStr) {
  if (!localStr) return null;
  try {
    const { timezone } = getWorkspaceSettings();
    // Use Temporal-like approach: treat localStr as workspace-local time
    // We create a Date assuming the string is in the workspace timezone
    const [datePart, timePart] = localStr.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute] = (timePart || '00:00').split(':').map(Number);

    // Create date in UTC and adjust for timezone offset
    const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute));
    // Get the timezone offset for this moment
    const tzOffset = getTimezoneOffset(timezone, utcDate);
    return new Date(utcDate.getTime() - tzOffset * 60000).toISOString();
  } catch {
    return new Date(localStr).toISOString();
  }
}

/**
 * Convert an ISO UTC string to local datetime string (YYYY-MM-DDTHH:mm)
 * in the workspace timezone — for use as input value.
 */
export function isoToLocal(isoStr) {
  if (!isoStr) return '';
  try {
    const date = new Date(isoStr);
    const { timezone } = getWorkspaceSettings();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(date);
    const get = (type) => parts.find(p => p.type === type)?.value || '00';
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
  } catch {
    return isoStr?.slice(0, 16) || '';
  }
}

function getTimezoneOffset(timezone, date) {
  try {
    const utcStr  = date.toLocaleString('en-US', { timeZone: 'UTC' });
    const tzStr   = date.toLocaleString('en-US', { timeZone: timezone });
    return (new Date(utcStr) - new Date(tzStr)) / 60000;
  } catch { return 0; }
}

/**
 * Returns a human-friendly relative time string.
 * e.g. "just now", "2 mins ago", "3 hours ago", "Yesterday", "Jun 5"
 */
export function timeAgo(isoString) {
  if (!isoString) return "";
  const date  = new Date(isoString);
  const now   = new Date();
  const secs  = Math.floor((now - date) / 1000);
  if (secs < 10)  return "just now";
  if (secs < 60)  return `${secs}s ago`;
  const mins  = Math.floor(secs / 60);
  if (mins < 60)  return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hrs   = Math.floor(mins / 60);
  if (hrs  < 24)  return `${hrs} hr${hrs   === 1 ? "" : "s"} ago`;
  const days  = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  if (days < 7)   return `${days} days ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
