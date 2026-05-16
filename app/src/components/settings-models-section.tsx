"use client";

import { useMemo, useState } from "react";

import { ModelPickerModal } from "@/components/model-picker-modal";
import {
  DEFAULT_MODEL_ASSIGNMENTS,
  MODEL_ROLES,
  findModelBySlug,
  mockLlmModels,
  type LlmModel,
  type ModelRole,
  type ModelRoleKey,
} from "@/lib/mock/llm-models";

interface SettingsModelsSectionProps {
  canEdit: boolean;
}

/**
 * The /settings "Models" section — three rows, one per role, each
 * showing the currently-assigned OpenRouter slug + a Change button
 * for admins. Phase 1 holds the assignments in session state; Phase 6
 * will swap setState for a Server Action that writes to a settings
 * table the engine reads at run-start.
 */
export function SettingsModelsSection({
  canEdit,
}: SettingsModelsSectionProps) {
  const [assignments, setAssignments] = useState<Record<ModelRoleKey, string>>(
    DEFAULT_MODEL_ASSIGNMENTS,
  );
  const [editingRole, setEditingRole] = useState<ModelRole | null>(null);

  const optionsForRole = useMemo(() => {
    const map: Record<ModelRoleKey, LlmModel[]> = {
      research: [],
      judge: [],
      regenerator: [],
    };
    for (const m of mockLlmModels) {
      for (const r of m.roles) map[r].push(m);
    }
    // Sort each role's options: recommended-tier first, then alpha within tier.
    const tierWeight = { value: 0, balanced: 1, frontier: 2 } as const;
    for (const key of Object.keys(map) as ModelRoleKey[]) {
      map[key].sort(
        (a, b) =>
          tierWeight[a.tier] - tierWeight[b.tier] ||
          a.name.localeCompare(b.name),
      );
    }
    return map;
  }, []);

  const hasChanges = (Object.keys(assignments) as ModelRoleKey[]).some(
    (k) => assignments[k] !== DEFAULT_MODEL_ASSIGNMENTS[k],
  );

  return (
    <section className="rounded-lg border border-gray-100 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-6 py-4">
        <div>
          <div className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-orange">
            LLM models
          </div>
          <h2 className="font-display text-lg font-semibold text-navy-deep">
            What the agent thinks with
          </h2>
        </div>
        {hasChanges && (
          <button
            type="button"
            onClick={() => setAssignments(DEFAULT_MODEL_ASSIGNMENTS)}
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Reset to defaults
          </button>
        )}
      </header>

      <ul className="divide-y divide-gray-100">
        {MODEL_ROLES.map((role) => {
          const currentSlug = assignments[role.key];
          const model = findModelBySlug(currentSlug);
          return (
            <li
              key={role.key}
              className="grid grid-cols-1 gap-3 px-6 py-4 sm:grid-cols-[1fr_auto]"
            >
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium text-navy-deep">
                    {role.label}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-gray-400">
                    {role.usedBy}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-gray-500">{role.description}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-800">
                    {currentSlug}
                  </code>
                  {model && (
                    <span className="text-[11px] text-gray-500">
                      {model.name} · {model.provider} · {model.contextWindowK}K context
                    </span>
                  )}
                </div>
              </div>
              <div className="self-center justify-self-end">
                <button
                  type="button"
                  onClick={() => setEditingRole(role)}
                  disabled={!canEdit}
                  className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-navy-deep transition-colors hover:border-navy hover:bg-navy-soft disabled:cursor-not-allowed disabled:opacity-50"
                  title={canEdit ? undefined : "Admins only"}
                >
                  Change
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {editingRole && (
        <ModelPickerModal
          key={editingRole.key}
          role={editingRole}
          options={optionsForRole[editingRole.key]}
          currentSlug={assignments[editingRole.key]}
          onClose={() => setEditingRole(null)}
          onApply={(slug) =>
            setAssignments((prev) => ({ ...prev, [editingRole.key]: slug }))
          }
        />
      )}
    </section>
  );
}
