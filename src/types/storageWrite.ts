/** Serialize same-origin writers when the browser provides Web Locks. */
export function withStorageWriteLock(key: string, write: () => void, onLockError?: () => void) {
  const locks = typeof window !== 'undefined' ? window.navigator?.locks : undefined;
  if (locks) {
    void locks.request(key, write).catch(() => onLockError?.());
  } else {
    write();
  }
}
