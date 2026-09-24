// Categories have no dedicated table (ADMIN-02A decision: an open list, not
// a fixed one). To stop "Ortopedia" and "ortopedia" from becoming two
// invisible different categories, every category typed by an admin is
// resolved, before saving, against the categories already used elsewhere in
// the catalog, matching without regard to case or surrounding spaces.
export function normalizeCategoryKey(category: string): string {
  return category.trim().toLowerCase();
}

/** Maps a normalized key to the first-seen exact spelling for that category. */
export function buildCategoryDirectory(existingCategories: Array<string | undefined>): Map<string, string> {
  const directory = new Map<string, string>();
  for (const raw of existingCategories) {
    const trimmed = (raw ?? '').trim();
    if (!trimmed) continue;
    const key = normalizeCategoryKey(trimmed);
    if (!directory.has(key)) directory.set(key, trimmed);
  }
  return directory;
}

/** If the typed category matches an existing one case-insensitively, returns
 * the existing spelling instead, so no near-duplicate category is created. */
export function resolveCategoryInput(input: string, directory: Map<string, string>): string {
  const trimmed = input.trim();
  return directory.get(normalizeCategoryKey(trimmed)) ?? trimmed;
}
