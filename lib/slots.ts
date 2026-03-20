import { CalendarEvent, FreeSlot } from '@/types';

const TIME_WINDOWS: Record<string, { start: number; end: number }> = {
  morning: { start: 9 * 60, end: 12 * 60 }, // 09:00 - 12:00
  afternoon: { start: 12 * 60, end: 17 * 60 }, // 12:00 - 17:00
  evening: { start: 17 * 60, end: 20 * 60 }, // 17:00 - 20:00
  any: { start: 8 * 60, end: 20 * 60 }, // 08:00 - 20:00
};

interface BusyInterval {
  start: number;
  end: number;
}

interface SlotMinutes {
  startMinutes: number;
  endMinutes: number;
}

function toMinutes(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

export function computeFreeSlots(
  events: CalendarEvent[],
  durationMinutes: number,
  preference: string = 'any',
  bufferBeforeMinutes?: number,
  hardDeadline?: string
): FreeSlot[] {
  const window = TIME_WINDOWS[preference] || TIME_WINDOWS.any;
  const slots: SlotMinutes[] = [];

  // Sort events by start time
  const sorted = [...events].sort(
    (a, b) =>
      new Date(a.start.dateTime).getTime() - new Date(b.start.dateTime).getTime()
  );

  // Build busy intervals in minutes-from-midnight
  const busy: BusyInterval[] = sorted.map((e) => ({
    start: toMinutes(new Date(e.start.dateTime)),
    end: toMinutes(new Date(e.end.dateTime)),
  }));

  // Apply hard deadline
  const deadlineMinutes = hardDeadline
    ? toMinutes(new Date(hardDeadline))
    : window.end;

  // Effective window
  const searchEnd = Math.min(window.end, deadlineMinutes);

  // Walk through the day finding gaps
  let cursor = window.start;
  for (const interval of busy) {
    const effectiveBuffer = bufferBeforeMinutes ?? 0;
    if (
      cursor + durationMinutes <= interval.start &&
      cursor + durationMinutes <= searchEnd
    ) {
      // Gap exists before this event
      let slotEnd = Math.min(interval.start, searchEnd);
      // Generate 30-min-aligned slots within this gap
      let s = cursor;
      while (s + durationMinutes <= slotEnd) {
        slots.push({ startMinutes: s, endMinutes: s + durationMinutes });
        s += 30; // step every 30 mins
      }
    }
    cursor = Math.max(cursor, interval.end + effectiveBuffer);
  }

  // Check gap after last event
  let s = cursor;
  while (s + durationMinutes <= searchEnd) {
    slots.push({ startMinutes: s, endMinutes: s + durationMinutes });
    s += 30;
  }

  // Return max 4 slots for cleaner UX
  return slots.slice(0, 4).map((slot) => ({
    startTime: minutesToTime(slot.startMinutes),
    endTime: minutesToTime(slot.endMinutes),
    startMinutes: slot.startMinutes,
    endMinutes: slot.endMinutes,
  }));
}