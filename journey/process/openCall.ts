// Opening a call (package C): the call page in a window of its own, at /process/{id}/call under the prefix the journey
// runs under (the demo's too). If the browser blocks the window, the page opens here and says so. Shared by "Prepare a
// call" in Closing the gaps and in Discovery's "Where discovery stands" (C4a).
export function openCall(processId: string): void {
  const prefix = window.location.pathname.split('/process/')[0] ?? '';
  const href = `${prefix}/process/${processId}/call`;
  const w = window.open(href, `avala-call-${processId}`);
  if (!w) window.location.href = `${href}?opened=here`;
}
