/**
 * Suggest existing categories related to a proposed one, using a
 * tiny token-overlap score. Used by the "Category fit" block on
 * suggestion cards to surface peer / vertical / parent categories
 * the reviewer might prefer over creating a brand-new one.
 *
 * Why token overlap (vs. embeddings):
 *   - 40-50 existing categories × one new suggestion per card is
 *     cheap — pure JS, sub-millisecond per call.
 *   - Doesn't need a Voyage round-trip or any DB roundtrip.
 *   - Works well on the kind of names categories tend to have
 *     ("Workplace Safety", "AI Skills", "Sales Negotiation") —
 *     where shared meaningful tokens reliably indicate kinship.
 *
 * Not a replacement for an embedding-based recommender on bigger
 * inventories — drop one in if the catalogue ever crosses a few
 * hundred categories.
 */

/** English stopwords that swamp the score without adding signal. */
const STOPWORDS = new Set([
  "a", "an", "and", "as", "at", "by", "for", "from", "in", "of",
  "on", "or", "the", "to", "with", "into", "via",
]);

/** Lowercase + split on anything non-alphanumeric; drop short + stopwords. */
function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
  );
}

export interface RelatedCategory {
  name: string;
  courseCount: number;
  matchedTokens: string[];
  /** 0..1 Jaccard score on token sets. Higher = more similar. */
  score: number;
}

/**
 * Rank `candidates` by how much their names share with `target`.
 * Caller passes only existing categories — the target itself, if it
 * happens to be in `candidates`, is excluded so we never recommend
 * "filed under exactly the same thing".
 *
 * @param target   The proposed category name (suggestion.category)
 * @param candidates  Curated categories with their course counts
 * @param limit    Max results to return (default 3)
 * @param minScore Minimum Jaccard score required (default 0.15)
 */
export function findRelatedCategories(
  target: string,
  candidates: { name: string; courseCount: number }[],
  { limit = 3, minScore = 0.15 }: { limit?: number; minScore?: number } = {},
): RelatedCategory[] {
  const targetTokens = tokenize(target);
  if (targetTokens.size === 0) return [];

  const scored: RelatedCategory[] = [];
  for (const c of candidates) {
    if (c.name === target) continue;
    const ct = tokenize(c.name);
    if (ct.size === 0) continue;
    let overlap = 0;
    const matched: string[] = [];
    for (const t of targetTokens) {
      if (ct.has(t)) {
        overlap += 1;
        matched.push(t);
      }
    }
    if (overlap === 0) continue;
    // Jaccard: |A ∩ B| / |A ∪ B|. Robust to either side being long.
    const union = targetTokens.size + ct.size - overlap;
    const score = overlap / union;
    if (score < minScore) continue;
    scored.push({
      name: c.name,
      courseCount: c.courseCount,
      matchedTokens: matched,
      score,
    });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tie-break: bigger catalogue presence wins.
    return b.courseCount - a.courseCount;
  });
  return scored.slice(0, limit);
}
