// Small local relative-time formatter (no date-fns dependency in this project). Mirrors the
// "less than a minute ago" / "about 5 hours ago" / "3 days ago" phrasing used in the editor's
// history panel.
export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));

  if (seconds < 60) return "less than a minute ago";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes === 1 ? "about a minute ago" : `about ${minutes} minutes ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "about an hour ago" : `about ${hours} hours ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return days === 1 ? "a day ago" : `${days} days ago`;

  const months = Math.round(days / 30);
  if (months < 12) return months === 1 ? "about a month ago" : `about ${months} months ago`;

  const years = Math.round(months / 12);
  return years === 1 ? "about a year ago" : `about ${years} years ago`;
}

// e.g. "Aug 24, 2026 02:55 PM"
export function formatAbsoluteTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
