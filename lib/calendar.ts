import { CalendarEvent, FreeSlot, AvailabilityResult, BookingResult } from '@/types';
import { computeFreeSlots } from './slots';

const BASE = process.env.CALENDAR_API_URL || 'http://localhost:8080';

// Store tokens in memory (for now - should be persisted)
let storedAccessToken: string | null = null;
let storedRefreshToken: string | null = null;

export function setCalendarTokens(accessToken: string, refreshToken: string) {
  storedAccessToken = accessToken;
  storedRefreshToken = refreshToken;
}

export function getCalendarTokens() {
  return { accessToken: storedAccessToken, refreshToken: storedRefreshToken };
}

export const calendarAPI = {
  async getEventsOnDate(date: string, accessToken?: string): Promise<{ items: CalendarEvent[] }> {
    const token = accessToken || storedAccessToken;

    if (!token) {
      throw new Error('Calendar not connected');
    }

    const timeMin = `${date}T00:00:00Z`;
    const timeMax = `${date}T23:59:59Z`;

    const res = await fetch(
      `${BASE}/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Refresh-Token': storedRefreshToken || '',
        },
      }
    );

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Failed to fetch events: ${res.status} ${error}`);
    }

    const data = await res.json();
    return { items: data.events || [] };
  },

  async checkAvailability(
    date: string,
    durationMinutes: number,
    preference: string = 'any',
    bufferBeforeMinutes?: number,
    hardDeadline?: string,
    accessToken?: string
  ): Promise<AvailabilityResult> {
    const token = accessToken || storedAccessToken;

    if (!token) {
      return { slots: [] };
    }

    try {
      const { items: events } = await this.getEventsOnDate(date, token);
      const slots = computeFreeSlots(events, durationMinutes, preference, bufferBeforeMinutes, hardDeadline);
      return { slots };
    } catch (error) {
      console.error('Error checking availability:', error);
      return { slots: [] };
    }
  },

  async bookMeeting(
    startDatetime: string,
    durationMinutes: number,
    title: string,
    description?: string,
    accessToken?: string
  ): Promise<BookingResult> {
    const token = accessToken || storedAccessToken;

    if (!token || !BASE) {
      return { error: 'Calendar API not configured or not authenticated' };
    }

    const start = new Date(startDatetime);
    const end = new Date(start.getTime() + durationMinutes * 60000);

    try {
      const res = await fetch(`${BASE}/calendars/primary/events`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Refresh-Token': storedRefreshToken || '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          summary: title,
          description: description ?? '',
          start: { dateTime: start.toISOString(), timeZone: 'Asia/Kolkata' },
          end: { dateTime: end.toISOString(), timeZone: 'Asia/Kolkata' },
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        return { error: `Failed to book meeting: ${errorText}` };
      }

      return await res.json();
    } catch (error) {
      return { error: `Booking failed: ${error}` };
    }
  },

  async findEventByName(
    query: string,
    searchFromDate?: string,
    accessToken?: string
  ): Promise<{ events: CalendarEvent[] }> {
    const token = accessToken || storedAccessToken;

    if (!token) {
      return { events: [] };
    }

    const from = searchFromDate || new Date().toISOString().split('T')[0];
    const { items: events } = await this.getEventsOnDate(from, token);

    const matched = events.filter((e) =>
      e.summary?.toLowerCase().includes(query.toLowerCase())
    );

    return { events: matched };
  },

  async getUpcomingEvents(
    days: number = 7,
    accessToken?: string
  ): Promise<{ events: CalendarEvent[] }> {
    const token = accessToken || storedAccessToken;

    if (!token) {
      return { events: [] };
    }

    const now = new Date();
    const timeMin = now.toISOString();
    const endDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const timeMax = endDate.toISOString();

    try {
      const res = await fetch(
        `${BASE}/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Refresh-Token': storedRefreshToken || '',
          },
        }
      );

      if (!res.ok) {
        const error = await res.text();
        throw new Error(`Failed to fetch events: ${res.status} ${error}`);
      }

      const data = await res.json();
      return { events: data.events || [] };
    } catch (error) {
      console.error('Error fetching upcoming events:', error);
      return { events: [] };
    }
  },

  async cancelMeeting(
    eventId: string,
    accessToken?: string
  ): Promise<{ success: boolean; error?: string }> {
    const token = accessToken || storedAccessToken;

    if (!token || !BASE) {
      return { success: false, error: 'Calendar API not configured' };
    }

    try {
      const res = await fetch(`${BASE}/calendars/primary/events/${eventId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Refresh-Token': storedRefreshToken || '',
        },
      });

      if (!res.ok) {
        const errorText = await res.text();
        return { success: false, error: `Failed to cancel: ${errorText}` };
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: `Cancel failed: ${error}` };
    }
  },
};