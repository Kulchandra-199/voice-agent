'use client';

import { FreeSlot } from '@/types';

interface CalendarCardProps {
  date: string;
  slots?: FreeSlot[];
  isConfirmed?: boolean;
  meetingTitle?: string;
}

function formatDate(dateStr: string): { day: string; date: string } {
  const date = new Date(dateStr + 'T00:00:00');
  return {
    day: date.toLocaleDateString('en-US', { weekday: 'short' }),
    date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  };
}

export function CalendarCard({ date, slots, isConfirmed, meetingTitle }: CalendarCardProps) {
  const { day, date: dateStr } = formatDate(date);

  return (
    <div className={`calendar-card ${isConfirmed ? 'confirmed' : ''}`}>
      {isConfirmed ? (
        <div className="confirmation-content">
          <div className="check-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div className="confirmation-text">
            <span className="title">{meetingTitle || 'Meeting'}</span>
            <span className="details">Booked for {day}, {dateStr}</span>
          </div>
        </div>
      ) : slots && slots.length > 0 ? (
        <div className="slots-content">
          <div className="date-header">
            <span className="day">{day}</span>
            <span className="date">{dateStr}</span>
          </div>
          <div className="slots-list">
            {slots.slice(0, 3).map((slot, index) => (
              <div key={index} className="slot-item">
                {slot.startTime} - {slot.endTime}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="no-slots">
          <span>No available slots</span>
        </div>
      )}

      <style jsx>{`
        .calendar-card {
          background: #141414;
          border: 1px solid #1f1f1f;
          border-left: 3px solid #6366f1;
          border-radius: 12px;
          padding: 16px;
          margin: 12px 0;
          min-width: 200px;
          animation: fadeIn 0.3s ease;
        }

        .calendar-card.confirmed {
          border-left-color: #4ade80;
          background: rgba(74, 222, 128, 0.05);
        }

        .confirmation-content {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .check-icon {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: #4ade80;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .check-icon svg {
          width: 18px;
          height: 18px;
          color: #0a0a0a;
        }

        .confirmation-text {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .confirmation-text .title {
          font-weight: 600;
          color: #f5f5f5;
          font-size: 15px;
        }

        .confirmation-text .details {
          color: #71717a;
          font-size: 13px;
        }

        .date-header {
          display: flex;
          align-items: baseline;
          gap: 8px;
          margin-bottom: 12px;
          padding-bottom: 8px;
          border-bottom: 1px solid #1f1f1f;
        }

        .day {
          font-weight: 600;
          color: #6366f1;
          font-size: 14px;
          text-transform: uppercase;
        }

        .date {
          color: #71717a;
          font-size: 13px;
        }

        .slots-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .slot-item {
          color: #f5f5f5;
          font-size: 14px;
          padding: 6px 10px;
          background: rgba(99, 102, 241, 0.1);
          border-radius: 6px;
        }

        .no-slots {
          color: #71717a;
          font-size: 14px;
          text-align: center;
          padding: 8px;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}