"use client";

import { useEffect, useId, useRef, useState } from "react";

import {
  type LlmModel,
  type ModelRole,
} from "@/lib/mock/llm-models";
import { cn } from "@/lib/utils";

interface ModelPickerModalProps {
  onClose: () => void;
  role: ModelRole;
  /** Catalog filtered to models compatible with `role`. */
  options: LlmModel[];
  /** Currently-active slug for this role. */
  currentSlug: string;
  onApply: (slug: string) => void;
}

/**
 * Modal for picking the OpenRouter model that fills one role
 * (research / judge / regenerator). Each open is a fresh mount; the
 * parent controls visibility by conditionally rendering.
 */
export function ModelPickerModal({
  onClose,
  role,
  options,
  currentSlug,
  onApply,
}: ModelPickerModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<string>(currentSlug);
  const titleId = useId();

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onApply(selected);
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="w-full max-w-2xl rounded-lg border border-gray-100 bg-white p-0 shadow-lg backdrop:bg-navy-deep/40 backdrop:backdrop-blur-sm"
      aria-labelledby={titleId}
    >
      <form onSubmit={handleSubmit}>
        <header className="border-b border-gray-100 px-6 py-5">
          <div className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-orange">
            Admin · model selection
          </div>
          <h2
            id={titleId}
            className="mt-1 font-display text-lg font-semibold text-navy-deep"
          >
            Choose the {role.label.toLowerCase()}
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            {role.description}{" "}
            <span className="text-gray-400">({role.usedBy})</span>
          </p>
        </header>

        <fieldset className="max-h-[480px] overflow-y-auto px-6 py-4">
          <legend className="sr-only">Available OpenRouter models</legend>
          <ul className="space-y-2">
            {options.map((m) => {
              const isCurrent = m.slug === currentSlug;
              const isSelected = m.slug === selected;
              return (
                <li key={m.slug}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors",
                      isSelected
                        ? "border-navy bg-navy-soft"
                        : "border-gray-100 hover:border-gray-200 hover:bg-off-white",
                    )}
                  >
                    <input
                      type="radio"
                      name="model"
                      value={m.slug}
                      checked={isSelected}
                      onChange={() => setSelected(m.slug)}
                      className="mt-1 h-4 w-4 border-gray-300 text-navy focus:ring-navy/30"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-navy-deep">{m.name}</span>
                          <TierPill tier={m.tier} />
                          {isCurrent && (
                            <span className="rounded-full bg-green-soft px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wider text-green-700">
                              Current
                            </span>
                          )}
                        </div>
                        <span className="font-mono text-[11px] text-gray-500">
                          {m.contextWindowK}K context · {m.provider}
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-gray-600">
                        {m.description}
                      </p>
                      <code className="mt-1 inline-block rounded bg-gray-100 px-1 font-mono text-[11px] text-gray-700">
                        {m.slug}
                      </code>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>

        <footer className="flex items-center justify-between gap-2 border-t border-gray-100 bg-off-white px-6 py-4">
          <p className="text-[11px] text-gray-500">
            The engine reads this on every run. Phase 6 wires it; Phase 1
            stores the choice in session state only.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={selected === currentSlug}
              className="rounded-md bg-navy px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:cursor-not-allowed disabled:bg-navy/40"
            >
              Apply
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}

function TierPill({ tier }: { tier: "value" | "balanced" | "frontier" }) {
  const map = {
    value: "bg-green-soft text-green-700",
    balanced: "bg-navy-soft text-navy-deep",
    frontier: "bg-orange-pale text-orange",
  } as const;
  return (
    <span
      className={`rounded-full px-2 py-0.5 font-display text-[9px] font-semibold uppercase tracking-widest ${map[tier]}`}
    >
      {tier}
    </span>
  );
}
