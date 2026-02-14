export const areAllVisibleIdsSelected = (visibleIds = [], selectedIds = []) => {
  if (!Array.isArray(visibleIds) || visibleIds.length === 0) return false;
  const selectedSet = new Set(Array.isArray(selectedIds) ? selectedIds : []);
  return visibleIds.every((id) => selectedSet.has(id));
};

export const pruneSelectionByAllowedIds = (selectedIds = [], allowedIds = []) => {
  if (!Array.isArray(selectedIds) || selectedIds.length === 0) return [];
  const allowedSet = new Set(Array.isArray(allowedIds) ? allowedIds : []);
  return selectedIds.filter((id) => allowedSet.has(id));
};
