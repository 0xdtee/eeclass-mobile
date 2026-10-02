/**
 * Save a generated file (Word / PDF / subtitles / zip) to the user's device.
 *
 * In a browser an <a download> click does it. Inside the native Capacitor app the WebView ignores that
 * (a blob link just navigates nowhere), so there the file is handed to the system share sheet instead,
 * where "Save to Files" / another app can take it.
 */
function isNativeApp(): boolean {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

/** Strip characters file systems reject, so a course title can be used as a file name. */
export function safeFileName(name: string, fallback = '课程'): string {
  return (name || fallback).replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || fallback;
}

export async function saveBlob(blob: Blob, filename: string): Promise<void> {
  if (isNativeApp() && typeof navigator.share === 'function') {
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
    if (!navigator.canShare || navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return;
      } catch (e) {
        if ((e as DOMException)?.name === 'AbortError') return;   // the user closed the share sheet
        // otherwise fall through to the plain download
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoking right after the click makes Safari cancel the download
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
