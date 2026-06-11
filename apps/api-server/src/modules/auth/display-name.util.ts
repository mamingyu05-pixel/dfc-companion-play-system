const DISPLAY_NAME_SPACES = /\s+/g;

export function normalizeDisplayNameKey(displayName: string) {
  return displayName.normalize("NFKC").trim().replace(DISPLAY_NAME_SPACES, " ").toLowerCase();
}
