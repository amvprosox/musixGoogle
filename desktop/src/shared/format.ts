export function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '0:00';
  }
  const whole = Math.floor(totalSeconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  const ss = seconds.toString().padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${ss}`;
  }
  return `${minutes}:${ss}`;
}

export function parseDuration(text: string): number {
  const trimmed = text.trim();
  if (!/^\d+(:\d{1,2}){0,2}$/.test(trimmed)) {
    return 0;
  }
  return trimmed
    .split(':')
    .map((part) => Number.parseInt(part, 10))
    .reduce((acc, part) => acc * 60 + part, 0);
}

export function formatCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return '0';
  }
  return Math.floor(value).toLocaleString('en-US');
}

export function formatTimestamp(epochMs: number | null, now: number = Date.now()): string {
  if (epochMs === null || !Number.isFinite(epochMs) || epochMs <= 0) {
    return 'Never';
  }
  const diff = Math.max(0, now - epochMs);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) {
    return 'Just now';
  }
  if (diff < hour) {
    const m = Math.floor(diff / minute);
    return `${m} minute${m === 1 ? '' : 's'} ago`;
  }
  if (diff < day) {
    const h = Math.floor(diff / hour);
    return `${h} hour${h === 1 ? '' : 's'} ago`;
  }
  const d = Math.floor(diff / day);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}
