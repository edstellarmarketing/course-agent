"use client";

import { useState, useTransition } from "react";

import {
  createPromptCandidate,
  promotePromptVersion,
  restorePromptVersion,
  retirePromptVersion,
} from "@/app/(app)/learning/actions";
import { cn } from "@/lib/utils";

export interface PromptVersionRowProps {
  id: string;
  version: number;
  status: "active" | "candidate" | "retired";
  modelSlug: string;
  notes: string | null;
  approvalRate: number | null;
  runsObserved: number;
  systemPrompt: string;
  canEdit: boolean;
}

/**
 * One row in the prompt-version stack on /learning.
 *
 * - View / Edit modal: open the full system_prompt text. Admins
 *   can edit and save as a new candidate; non-admins can only view.
 * - Promote (candidate -> active): existing button.
 * - Restore (retired -> active): rollback in one click. Confirms
 *   before firing because it flips the current active to retired.
 * - Retire: existing.
 */
export function PromptVersionRow(props: PromptVersionRowProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [modalOpen, setModalOpen] = useState(false);

  const handlePromote = () => {
    setError(null);
    startTransition(async () => {
      const result = await promotePromptVersion(props.id);
      if (!result.ok) setError(result.error);
    });
  };

  const handleRetire = () => {
    setError(null);
    startTransition(async () => {
      const result = await retirePromptVersion(props.id);
      if (!result.ok) setError(result.error);
    });
  };

  const handleRestore = () => {
    setError(null);
    if (!confirm(`Restore v${props.version} as active? The current active prompt will be retired.`)) return;
    startTransition(async () => {
      const result = await restorePromptVersion(props.id);
      if (!result.ok) setError(result.error);
    });
  };

  return (
    <li className="grid grid-cols-1 gap-3 px-6 py-4 sm:grid-cols-[auto_1fr_auto_auto]">
      <div className="flex items-center gap-3">
        <span className="rounded-md bg-navy-soft px-2 py-1 font-display text-xs font-semibold text-navy-deep">
          v{props.version}
        </span>
        <StatusPill status={props.status} />
      </div>

      <div className="min-w-0">
        <div className="font-mono text-xs text-gray-500">{props.modelSlug}</div>
        {props.notes && (
          <p className="mt-0.5 line-clamp-2 text-sm text-gray-600">
            {props.notes}
          </p>
        )}
        {error && (
          <div
            role="alert"
            className="mt-2 rounded-md border border-red-200 bg-red-soft px-2.5 py-1.5 text-xs text-red-700"
          >
            {error}
          </div>
        )}
      </div>

      <div className="text-right text-sm">
        <div className="font-mono font-semibold text-navy-deep">
          {props.approvalRate == null
            ? "—"
            : `${Math.round(props.approvalRate * 100)}%`}
        </div>
        <div className="text-[11px] text-gray-500">
          {props.runsObserved} run{props.runsObserved === 1 ? "" : "s"}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 self-end">
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          {props.canEdit ? "View / Edit" : "View"}
        </button>

        {props.status === "candidate" && props.canEdit && (
          <button
            type="button"
            disabled={pending}
            onClick={handlePromote}
            className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-green-300"
          >
            Promote
          </button>
        )}
        {props.status === "retired" && props.canEdit && (
          <button
            type="button"
            disabled={pending}
            onClick={handleRestore}
            className="rounded-md bg-orange px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-orange-light disabled:cursor-not-allowed disabled:opacity-50"
          >
            Restore as active
          </button>
        )}
        {(props.status === "candidate" || props.status === "active") &&
          props.canEdit && (
            <button
              type="button"
              disabled={pending}
              onClick={handleRetire}
              className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Retire
            </button>
          )}
      </div>

      {modalOpen && (
        <PromptModal
          version={props.version}
          status={props.status}
          modelSlug={props.modelSlug}
          systemPrompt={props.systemPrompt}
          canEdit={props.canEdit}
          onClose={() => setModalOpen(false)}
        />
      )}
    </li>
  );
}

function PromptModal({
  version,
  status,
  modelSlug,
  systemPrompt,
  canEdit,
  onClose,
}: {
  version: number;
  status: "active" | "candidate" | "retired";
  modelSlug: string;
  systemPrompt: string;
  canEdit: boolean;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(systemPrompt);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ version: number } | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSave = () => {
    setError(null);
    if (text === systemPrompt) {
      setError("No changes to save.");
      return;
    }
    startTransition(async () => {
      const result = await createPromptCandidate({
        systemPrompt: text,
        notes: notes || `Edited from v${version} via /learning UI`,
        modelSlug,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved({ version: result.version });
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy-deep/40 px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-label={`Prompt v${version}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-lg bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <div className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-orange">
              Prompt version
            </div>
            <h2 className="font-display text-lg font-semibold text-navy-deep">
              v{version} <span className="font-mono text-xs text-gray-500">· {modelSlug} · {status}</span>
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-gray-500 hover:bg-gray-50 hover:text-gray-800"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-auto px-6 py-4">
          {saved ? (
            <div className="rounded-md border border-green-200 bg-green-soft px-4 py-3 text-sm text-green-700">
              ✓ Saved as candidate <strong>v{saved.version}</strong>. Close this dialog
              and you'll see it in the list. Click Promote on the new row when you're
              ready to make it active.
            </div>
          ) : editing ? (
            <>
              <label
                htmlFor="prompt-text"
                className="block font-display text-[10px] font-semibold uppercase tracking-widest text-gray-500"
              >
                System prompt
              </label>
              <textarea
                id="prompt-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={28}
                className="mt-1.5 w-full rounded-md border border-gray-200 bg-white px-3 py-2 font-mono text-xs leading-relaxed text-gray-800 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
              />
              <label
                htmlFor="prompt-notes"
                className="mt-4 block font-display text-[10px] font-semibold uppercase tracking-widest text-gray-500"
              >
                Notes (shown in /learning row)
              </label>
              <input
                id="prompt-notes"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={`Edited from v${version} via /learning UI`}
                className="mt-1.5 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
              />
              {error && (
                <div
                  role="alert"
                  className="mt-3 rounded-md border border-red-200 bg-red-soft px-3 py-2 text-sm text-red-700"
                >
                  {error}
                </div>
              )}
            </>
          ) : (
            <pre className="whitespace-pre-wrap rounded-md bg-off-white px-4 py-3 font-mono text-xs leading-relaxed text-gray-800">
              {systemPrompt}
            </pre>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-gray-100 px-6 py-3">
          <div className="text-[11px] text-gray-500">
            {editing && !saved && (
              <>
                {text.length.toLocaleString()} chars
                {text !== systemPrompt && (
                  <span className="ml-2 text-orange">· unsaved changes</span>
                )}
              </>
            )}
            {!editing && !saved && (
              <>{systemPrompt.length.toLocaleString()} chars</>
            )}
          </div>
          <div className="flex items-center gap-2">
            {saved ? (
              <button
                type="button"
                onClick={onClose}
                className="rounded-md bg-navy px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep"
              >
                Close
              </button>
            ) : editing ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setText(systemPrompt);
                    setEditing(false);
                    setError(null);
                  }}
                  className="rounded-md border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel edit
                </button>
                <button
                  type="button"
                  disabled={pending || text === systemPrompt}
                  onClick={handleSave}
                  className="rounded-md bg-green-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-green-300"
                >
                  {pending ? "Saving…" : "Save as new candidate"}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Close
                </button>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="rounded-md bg-orange px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-light"
                  >
                    Edit as new candidate
                  </button>
                )}
              </>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

function StatusPill({
  status,
}: {
  status: "active" | "candidate" | "retired";
}) {
  const map = {
    active: "bg-green-soft text-green-700",
    candidate: "bg-orange-pale text-orange",
    retired: "bg-gray-100 text-gray-500",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wider",
        map[status],
      )}
    >
      {status}
    </span>
  );
}
