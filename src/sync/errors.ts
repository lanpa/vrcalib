// Kept free of Firebase imports so the editor can use it without loading the SDK.

/** Firebase errors in words a user can act on. */
export function describeError(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  if (/permission[_ ]denied/i.test(text)) {
    return 'permission denied: the database rules may not be published yet';
  }
  if (/admin-restricted-operation|operation-not-allowed/.test(text)) {
    return 'anonymous sign-in is not enabled in the Firebase project';
  }
  if (/network-request-failed/.test(text)) return 'no network connection';
  return text;
}
