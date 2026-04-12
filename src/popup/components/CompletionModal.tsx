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
      <div className="bg-white w-full rounded-t-2xl p-4 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-gray-900">Mark task done</h2>
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
            className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
          <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg">
            <p className="text-[10px] text-amber-600">{eligibility.reason}</p>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Completion note */}
          <textarea
            ref={textareaRef}
            className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 mb-1 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={2}
            placeholder="What did you finish? (required)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={submitting}
          />
          <p className="text-[10px] text-gray-400 mb-3">
            ⌘ Enter to submit · Esc to cancel
          </p>
          {error && <p className="mb-3 text-xs text-rose-600">{error}</p>}

          {/* Actions */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="flex-1 py-2 text-sm font-semibold text-white bg-blue-600 rounded-xl disabled:opacity-40 hover:bg-blue-700 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Saving…' : 'Done'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
