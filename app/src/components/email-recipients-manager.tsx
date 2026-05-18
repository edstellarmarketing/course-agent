"use client";

import { useState, useTransition } from "react";

import {
  addRecipient,
  deleteRecipient,
  updateRecipient,
} from "@/app/(app)/email-settings/actions";
import { cn } from "@/lib/utils";

export interface Recipient {
  id: string;
  email: string;
  isActive: boolean;
  assignedCategories: string[] | null;
  notes: string | null;
  updatedAt: string | null;
}

export function EmailRecipientsManager({
  recipients,
  categoryNames,
  canEdit,
}: {
  recipients: Recipient[];
  categoryNames: string[];
  canEdit: boolean;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const wrap = (run: () => Promise<{ ok: true } | { ok: true; id: string } | { ok: false; error: string }>) =>
    startTransition(async () => {
      setError(null);
      const r = await run();
      if (!r.ok) setError(r.error);
    });

  return (
    <section className="space-y-4">
      {canEdit && <AddRecipientForm categoryNames={categoryNames} onError={setError} />}

      <div className="rounded-lg border border-gray-100 bg-white">
        <header className="flex items-center justify-between border-b border-gray-100 px-6 py-4 text-sm text-gray-500">
          <span>
            <span className="font-display text-base font-semibold text-navy-deep">
              {recipients.length}
            </span>{" "}
            recipient{recipients.length === 1 ? "" : "s"}
            {" · "}
            <span className="text-green-700">
              {recipients.filter((r) => r.isActive).length} active
            </span>
          </span>
        </header>

        {error && (
          <div
            role="alert"
            className="mx-6 mt-3 rounded-md border border-red-200 bg-red-soft px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {recipients.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-gray-500">
            No recipients yet. Add one above to start receiving the daily digest.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-off-white text-left text-[10px] uppercase tracking-widest text-gray-500">
                <tr>
                  <th className="px-6 py-3 font-display font-semibold">Email</th>
                  <th className="px-6 py-3 font-display font-semibold">Active</th>
                  <th className="px-6 py-3 font-display font-semibold">Categories filter</th>
                  <th className="px-6 py-3 font-display font-semibold">Notes</th>
                  {canEdit && (
                    <th className="px-6 py-3 font-display font-semibold text-right">
                      Actions
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {recipients.map((r) =>
                  editingId === r.id ? (
                    <EditingRow
                      key={r.id}
                      recipient={r}
                      categoryNames={categoryNames}
                      pending={pending}
                      onCancel={() => setEditingId(null)}
                      onSave={(patch) =>
                        wrap(async () => {
                          const result = await updateRecipient(r.id, patch);
                          if (result.ok) setEditingId(null);
                          return result;
                        })
                      }
                    />
                  ) : (
                    <DisplayRow
                      key={r.id}
                      recipient={r}
                      canEdit={canEdit}
                      pending={pending}
                      onToggleActive={() =>
                        wrap(() =>
                          updateRecipient(r.id, { isActive: !r.isActive }),
                        )
                      }
                      onEdit={() => setEditingId(r.id)}
                      onDelete={() => {
                        if (!confirm(`Remove ${r.email} from the digest list?`)) return;
                        wrap(() => deleteRecipient(r.id));
                      }}
                    />
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Add form ───────────────────────────────────────────────────

function AddRecipientForm({
  categoryNames,
  onError,
}: {
  categoryNames: string[];
  onError: (msg: string | null) => void;
}) {
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [categoriesCsv, setCategoriesCsv] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [pending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onError(null);
    const assigned = categoriesCsv.trim()
      ? categoriesCsv.split(",").map((s) => s.trim()).filter(Boolean)
      : null;
    startTransition(async () => {
      const result = await addRecipient({
        email,
        isActive,
        assignedCategories: assigned,
        notes: notes || null,
      });
      if (!result.ok) {
        onError(result.error);
        return;
      }
      setEmail("");
      setNotes("");
      setCategoriesCsv("");
      setIsActive(true);
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-gray-100 bg-white p-4"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.2fr_2fr_2fr_auto_auto]">
        <input
          type="email"
          required
          placeholder="alex@edstellar.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
        />
        <input
          type="text"
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
        />
        <input
          type="text"
          list="category-suggestions"
          placeholder="Categories (comma-separated; blank = all)"
          value={categoriesCsv}
          onChange={(e) => setCategoriesCsv(e.target.value)}
          className="rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-navy focus:ring-navy/30"
          />
          Active
        </label>
        <button
          type="submit"
          disabled={pending || !email.trim()}
          className="rounded-md bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-deep disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Adding…" : "Add recipient"}
        </button>
      </div>
      <datalist id="category-suggestions">
        {categoryNames.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <p className="mt-2 text-[11px] text-gray-500">
        Categories: type or pick from autocomplete. Multiple comma-separated.
        Leave blank to receive every digest regardless of category.
      </p>
    </form>
  );
}

// ─── Row renderers ──────────────────────────────────────────────

function DisplayRow({
  recipient,
  canEdit,
  pending,
  onToggleActive,
  onEdit,
  onDelete,
}: {
  recipient: Recipient;
  canEdit: boolean;
  pending: boolean;
  onToggleActive: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <tr className="hover:bg-off-white">
      <td className="px-6 py-3 font-mono text-xs text-navy-deep">
        {recipient.email}
      </td>
      <td className="px-6 py-3">
        {canEdit ? (
          <button
            type="button"
            disabled={pending}
            onClick={onToggleActive}
            className={cn(
              "rounded-full px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wider transition-opacity disabled:opacity-50",
              recipient.isActive
                ? "bg-green-soft text-green-700"
                : "bg-gray-100 text-gray-500",
            )}
          >
            {recipient.isActive ? "Active" : "Paused"}
          </button>
        ) : (
          <span
            className={cn(
              "inline-flex rounded-full px-2 py-0.5 font-display text-[10px] font-semibold uppercase tracking-wider",
              recipient.isActive
                ? "bg-green-soft text-green-700"
                : "bg-gray-100 text-gray-500",
            )}
          >
            {recipient.isActive ? "Active" : "Paused"}
          </span>
        )}
      </td>
      <td className="px-6 py-3 text-gray-700">
        {recipient.assignedCategories &&
        recipient.assignedCategories.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {recipient.assignedCategories.map((c) => (
              <span
                key={c}
                className="rounded-full bg-navy-soft px-2 py-0.5 font-mono text-[10px] text-navy-deep"
              >
                {c}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-[11px] uppercase tracking-widest text-gray-400">
            All categories
          </span>
        )}
      </td>
      <td className="px-6 py-3 text-gray-600">
        {recipient.notes || (
          <span className="text-[11px] text-gray-400">—</span>
        )}
      </td>
      {canEdit && (
        <td className="px-6 py-3">
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={onEdit}
              className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Edit
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={onDelete}
              className="rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-soft disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        </td>
      )}
    </tr>
  );
}

function EditingRow({
  recipient,
  categoryNames,
  pending,
  onCancel,
  onSave,
}: {
  recipient: Recipient;
  categoryNames: string[];
  pending: boolean;
  onCancel: () => void;
  onSave: (patch: {
    email: string;
    isActive: boolean;
    assignedCategories: string[] | null;
    notes: string | null;
  }) => void;
}) {
  const [email, setEmail] = useState(recipient.email);
  const [isActive, setIsActive] = useState(recipient.isActive);
  const [categoriesCsv, setCategoriesCsv] = useState(
    (recipient.assignedCategories ?? []).join(", "),
  );
  const [notes, setNotes] = useState(recipient.notes ?? "");

  const handleSave = () => {
    const assigned = categoriesCsv.trim()
      ? categoriesCsv.split(",").map((s) => s.trim()).filter(Boolean)
      : null;
    onSave({ email, isActive, assignedCategories: assigned, notes: notes || null });
  };

  return (
    <tr className="bg-orange-pale/10">
      <td className="px-6 py-3">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 font-mono text-xs text-navy-deep focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
        />
      </td>
      <td className="px-6 py-3">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-navy focus:ring-navy/30"
          />
          Active
        </label>
      </td>
      <td className="px-6 py-3">
        <input
          type="text"
          list="category-suggestions"
          value={categoriesCsv}
          onChange={(e) => setCategoriesCsv(e.target.value)}
          placeholder="comma-separated; blank = all"
          className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-800 placeholder:text-gray-400 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
        />
      </td>
      <td className="px-6 py-3">
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-800 focus:border-navy focus:outline-none focus:ring-2 focus:ring-navy/15"
        />
      </td>
      <td className="px-6 py-3">
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={onCancel}
            className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={handleSave}
            className="rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </td>
    </tr>
  );
}
