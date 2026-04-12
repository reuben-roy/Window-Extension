import React, { useEffect, useState } from 'react';

interface PointsBubbleProps {
  points: number;
  level: number;
  title: string;
  compact?: boolean;
}

export default function PointsBubble({
  points,
  level,
  title,
  compact = false,
}: PointsBubbleProps): React.JSX.Element {
  const formatted = points.toLocaleString();

  return (
    <div className={`fg-points-bubble ${compact ? 'fg-points-bubble-compact' : ''}`}>
      <div className="fg-points-meta">
        <span className="fg-points-label">Level {level}</span>
        {!compact && <span className="fg-points-title">{title}</span>}
      </div>
      <div className="fg-points-value" aria-label={`${points} points`}>
        <span className="fg-points-prefix">pts</span>
        <RollingValue value={formatted} />
      </div>
    </div>
  );
}

function RollingValue({ value }: { value: string }): React.JSX.Element {
  return (
    <span className="fg-points-roll" aria-hidden="true">
      {value.split('').map((char, index) =>
        /\d/.test(char) ? (
          <RollingDigit key={`${index}-${char}`} digit={Number(char)} />
        ) : (
          <span key={`${index}-${char}`} className="fg-points-separator">
            {char}
          </span>
        ),
      )}
    </span>
  );
}

function RollingDigit({ digit }: { digit: number }): React.JSX.Element {
  const [currentDigit, setCurrentDigit] = useState(digit);
  const [previousDigit, setPreviousDigit] = useState(digit);
  const [direction, setDirection] = useState<'up' | 'down'>('up');
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (digit === currentDigit) return;

    setPreviousDigit(currentDigit);
    setDirection(digit > currentDigit ? 'up' : 'down');
    setAnimating(false);

    const frame = window.requestAnimationFrame(() => {
      setAnimating(true);
    });

    const timeout = window.setTimeout(() => {
      setCurrentDigit(digit);
      setAnimating(false);
    }, 260);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [digit, currentDigit]);

  if (!animating) {
    return (
      <span className="fg-points-digit-window">
        <span className="fg-points-digit">{currentDigit}</span>
      </span>
    );
  }

  return (
    <span className="fg-points-digit-window">
      <span
        className={`fg-points-digit-track ${
          direction === 'up'
            ? animating
              ? 'fg-points-digit-track-up-active'
              : 'fg-points-digit-track-up'
            : animating
              ? 'fg-points-digit-track-down-active'
              : 'fg-points-digit-track-down'
        }`}
      >
        {direction === 'up' ? (
          <>
            <span className="fg-points-digit">{previousDigit}</span>
            <span className="fg-points-digit">{digit}</span>
          </>
        ) : (
          <>
            <span className="fg-points-digit">{digit}</span>
            <span className="fg-points-digit">{previousDigit}</span>
          </>
        )}
      </span>
    </span>
  );
}
