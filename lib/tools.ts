import { ToolSchemas } from '@/types';
import { calendarAPI } from './calendar';

export const TOOL_SCHEMAS: ToolSchemas[] = [
  {
    type: 'function',
    function: {
      name: 'view_calendar',
      description:
        'View calendar events for a specific date. Use this to see what meetings/events exist on a given day, or to understand the user\'s schedule before suggesting meeting times.',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'Date in YYYY-MM-DD format (e.g., "2025-03-21")',
          },
        },
        required: ['date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_free_slots',
      description:
        'Find available time slots for scheduling a meeting. Always call this before proposing meeting times to the user. Returns free slots filtered by time preference.',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'Date in YYYY-MM-DD format',
          },
          duration_minutes: {
            type: 'number',
            description: 'Meeting duration in minutes (e.g., 30, 60, 90)',
          },
          preference: {
            type: 'string',
            enum: ['morning', 'afternoon', 'evening', 'any'],
            description:
              'Preferred time of day: morning (9AM-12PM), afternoon (12PM-5PM), evening (5PM-8PM), or any',
          },
          buffer_minutes: {
            type: 'number',
            description: 'Extra buffer time before meetings in minutes',
          },
          end_by: {
            type: 'string',
            description: 'Latest acceptable time in ISO format (e.g., "2025-03-21T18:00:00")',
          },
        },
        required: ['date', 'duration_minutes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'schedule_meeting',
      description:
        'Book a new calendar event. Only call this AFTER the user has explicitly confirmed the date, time, and title. Never schedule without confirmation.',
      parameters: {
        type: 'object',
        properties: {
          start_time: {
            type: 'string',
            description: 'Meeting start time in ISO format (e.g., "2025-03-21T14:00:00")',
          },
          duration_minutes: {
            type: 'number',
            description: 'Meeting duration in minutes',
          },
          title: {
            type: 'string',
            description: 'Meeting title/subject',
          },
          description: {
            type: 'string',
            description: 'Optional meeting description or notes',
          },
        },
        required: ['start_time', 'duration_minutes', 'title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_meeting',
      description:
        'Search for a specific meeting or event by name. Use when user mentions "my 3pm standup" or "the design review" to find event details.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Event name or keywords to search for',
          },
          from_date: {
            type: 'string',
            description: 'Start searching from this date (YYYY-MM-DD), defaults to today',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'view_upcoming',
      description:
        'View upcoming meetings and events for the next few days. Use this to answer "what\'s on my calendar" or show the user\'s schedule.',
      parameters: {
        type: 'object',
        properties: {
          days: {
            type: 'number',
            description: 'Number of days to look ahead (default: 7)',
          },
        },
        required: [] as string[],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_meeting',
      description:
        'Cancel or delete a meeting from the calendar. Use when user asks to cancel, remove, or delete a meeting. Requires the event ID.',
      parameters: {
        type: 'object',
        properties: {
          event_id: {
            type: 'string',
            description: 'The unique ID of the event to cancel (obtained from search or view_calendar)',
          },
        },
        required: ['event_id'],
      },
    },
  },
];

export async function executeTool(
  name: string,
  args: Record<string, any>,
  accessToken?: string
): Promise<any> {
  switch (name) {
    case 'view_calendar':
      return await calendarAPI.getEventsOnDate(args.date, accessToken || '');

    case 'find_free_slots':
      return await calendarAPI.checkAvailability(
        args.date,
        args.duration_minutes,
        args.preference ?? 'any',
        args.buffer_minutes,
        args.end_by,
        accessToken || ''
      );

    case 'schedule_meeting':
      return await calendarAPI.bookMeeting(
        args.start_time,
        args.duration_minutes,
        args.title,
        args.description,
        accessToken || ''
      );

    case 'search_meeting':
      return await calendarAPI.findEventByName(
        args.query,
        args.from_date,
        accessToken || ''
      );

    case 'view_upcoming':
      return await calendarAPI.getUpcomingEvents(
        args.days || 7,
        accessToken || ''
      );

    case 'cancel_meeting':
      return await calendarAPI.cancelMeeting(
        args.event_id,
        accessToken || ''
      );

    default:
      return { error: `Unknown tool: ${name}` };
  }
}