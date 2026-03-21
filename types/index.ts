export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolSchemas {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required: string[];
    };
  };
}

export interface FreeSlot {
  startTime: string;
  endTime: string;
  startMinutes: number;
  endMinutes: number;
}

/** Matches Google Calendar EventDateTime (timed or all-day). */
export interface CalendarEvent {
  summary?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  description?: string;
}

export interface AvailabilityResult {
  slots: FreeSlot[];
}

export interface BookingResult {
  id?: string;
  summary?: string;
  start?: { dateTime: string };
  end?: { dateTime: string };
  error?: string;
}

export interface TokenData {
  accessToken: string;
  refreshToken?: string;
  expiryDate?: number;
}