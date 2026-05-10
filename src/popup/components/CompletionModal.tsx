import React, { useEffect, useRef, useState } from 'react';
import type { Task } from '../../shared/types';

interface Props {
  tasks: Task[];
  onClose: () => void;
  /** Called after a task is successfully submitted (different from cancel). */
  onDone: () => void;
}

function canMarkDone(task: Task): { allowed: boolean; reason?: string } {
  const scheduledStart = new Date(task.scheduledStart).getTime();
  const scheduledEnd = new Date(task.scheduledEnd).getTime();
  const duration = scheduledEnd - scheduledStart;
  const minElapsed = duration * 0.5;
  const elapsedSinceStart = Date.now() - scheduledStart;

  if (elapsedSinceStart < minElapsed) {
    const minsLeft = Math.ceil((minElapsed - elapsedSinceStart) / 60_000);
    return {
      allowed: false,
      reason: `Anti-gaming: wait ${minsLeft} more min (50% of block must elapse first)`,
    };
  }
  return { allowed: true };
}

export default function CompletionModal({ tasks, onClose, onDone }: Props): React.JSX.Element {
  const [selectedTaskId, setSelectedTaskId] = useState(tasks[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const selectedTask = tasks.find((t) => t.id === selectedTaskId);
  const eligibility = selectedTask ? canMarkDone(selectedTask) : { allowed: false };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim() || !eligibility.allowed || submitting) return;
    setSubmitting(true);
    setError(null);
    chrome.runtime.sendMessage(
      { type: 'MARK_DONE', payload: { taskId: selectedTaskId, note: note.trim() } },
      (response: { ok?: boolean; error?: string }) => {
        setSubmitting(false);
        if (response?.ok) {
          onDone();
          return;
        }
        setError(response?.error ?? 'Task completion failed.');
      },
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSubmit(e as unknown as React.FormEvent);
    }
    if (e.key === 'Escape') onClose();
  };

  const canSubmit = note.trim().length > 0 && eligibility.allowed && !submitting;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end justify-center z-50">
      <div className="bg-white w-full rounded-t-xl p-3 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-bold text-gray-900">Mark task done</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Task selector */}
        {tasks.length > 1 && (
          <select
            className="fg-select mb-2 text-xs"
            value={selectedTaskId}
            onChange={(e) => setSelectedTaskId(e.target.value)}
          >
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.eventTitle}
                {t.status === 'carryover' ? ' (carryover)' : ''}
              </option>
            ))}
          </select>
        )}

        {/* Anti-gaming warning */}
        {!eligibility.allowed && eligibility.reason && (
          <div className="mb-2 px-2.5 py-1.5 bg-amber-50 border border-amber-100 rounded-md">
            <p className="text-[10px] text-amber-600">{eligibility.reason}</p>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Completion note */}
          <textarea
            ref={textareaRef}
            className="fg-input mb-1 w-full resize-none text-xs"
            rows={2}
            placeholder="What did you finish? (required)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={submitting}
          />
          <p className="text-[9px] text-gray-400 mb-2">
            ⌘ Enter to submit · Esc to cancel
          </p>
          {error && <p className="mb-2 text-[10px] text-rose-600">{error}</p>}

          {/* Actions */}
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={onClose}
              className="fg-button-secondary flex-1 py-1.5 text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="fg-button-primary flex-1 py-1.5 text-xs"
            >
              {submitting ? 'Saving…' : 'Done'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
