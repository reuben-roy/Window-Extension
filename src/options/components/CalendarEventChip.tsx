import React from 'react';

export function CalendarEventChip({
  eventId,
  title,
  timeText,
  backgroundColor,
  foregroundColor,
  onQuickOpen,
}: {
  eventId: string;
  title: string;
  timeText: string;
  backgroundColor: string;
  foregroundColor: string;
  onQuickOpen: (eventId: string, element: HTMLElement) => void;
}): React.JSX.Element {
  return (
    <div
      className="fg-event-chip cursor-pointer transition duration-150 hover:brightness-[1.03]"
      style={{ background: backgroundColor, color: foregroundColor }}
      onPointerDownCapture={(event) => {
        onQuickOpen(eventId, event.currentTarget as HTMLElement);
      }}
    >
      {timeText && <span className="fg-event-time">{timeText}</span>}
      <span className="fg-event-title">{title}</span>
    </div>
  );
}
