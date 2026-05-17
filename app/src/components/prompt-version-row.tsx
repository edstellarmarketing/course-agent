"use client";

import { useState, useTransition } from "react";

import {
  promotePromptVersion,
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
}

/**
 * One row in the prompt-version stack on /learning. Active and
 * candidate rows get Promote/Retire buttons gated by their status;
 * retired rows are read-only. Server Action wiring + an error
 * banner ride along.
 */
export function PromptVersionRow(props: PromptVersionRowProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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

      <div className="flex items-center gap-2 self-end">
        {props.status === "candidate" && (
          <button
            type="button"
            disabled={pending}
            onClick={handlePromote}
            className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-green-300"
          >
            Promote
          </button>
        )}
        {(props.status === "candidate" || props.status === "active") && (
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
    </li>
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
