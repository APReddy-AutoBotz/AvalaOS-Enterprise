// The BPMN canvas (bpmn-js), loaded only when someone edits the flow. It holds the drawing until the
// person saves; the model changes only after they confirm the listed changes.
import React from 'react';
import Modeler from 'bpmn-js/lib/Modeler';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';

export interface CanvasApi { save(): Promise<string>; load(xml: string): Promise<void>; fit(): void }
const STEPS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3];

export default function BpmnCanvas({ xml, onReady, onChange }: { xml: string; onReady: (api: CanvasApi) => void; onChange: () => void }) {
  const box = React.useRef<HTMLDivElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [zoom, setZoom] = React.useState(1);
  const modelerRef = React.useRef<any>(null);
  React.useEffect(() => {
    const modeler: any = new (Modeler as any)({ container: box.current!, keyboard: { bindTo: document } });
    modelerRef.current = modeler;
    const fit = () => { try { modeler.get('canvas').zoom('fit-viewport', 'auto'); setZoom(modeler.get('canvas').zoom()); } catch { /* not rendered yet */ } };
    modeler.on('canvas.viewbox.changed', (e: any) => setZoom(e.viewbox.scale));
    const load = async (x: string) => {
      try { await modeler.importXML(x); setError(null); fit(); }
      catch (e) { setError(e instanceof Error ? e.message : 'The diagram could not be drawn.'); }
    };
    modeler.on('commandStack.changed', onChange);
    if (typeof window !== 'undefined') (window as any).__bpmnModeler = modeler; // read by the browser tests
    load(xml).then(() => onReady({ save: async () => (await modeler.saveXML({ format: true })).xml, load, fit }));
    return () => { modeler.destroy(); if ((window as any).__bpmnModeler === modeler) delete (window as any).__bpmnModeler; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const zoomTo = (level: number | 'fit') => {
    const canvas = modelerRef.current?.get('canvas');
    if (!canvas) return;
    if (level === 'fit') canvas.zoom('fit-viewport', 'auto'); else canvas.zoom(Math.min(4, Math.max(0.2, level)), 'auto');
    setZoom(canvas.zoom());
  };
  const step = (dir: 1 | -1) => {
    const next = dir > 0 ? STEPS.find(s => s > zoom + 0.01) ?? zoom * 1.25 : [...STEPS].reverse().find(s => s < zoom - 0.01) ?? zoom / 1.25;
    zoomTo(next);
  };
  const btn = 'flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-semibold text-slate-700 hover:bg-slate-100';
  return (
    <div className="relative">
      <div className="absolute right-3 top-3 z-10 flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white/95 p-1 shadow-sm backdrop-blur" role="toolbar" aria-label="Zoom">
        <button type="button" className={btn} aria-label="Zoom out" title="Zoom out" onClick={() => step(-1)}>−</button>
        <span className="w-12 text-center text-xs tabular-nums text-slate-600" data-testid="zoom-level" aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button type="button" className={btn} aria-label="Zoom in" title="Zoom in" onClick={() => step(1)}>+</button>
        <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
        <button type="button" className={btn} onClick={() => zoomTo(1)}>100%</button>
        <button type="button" className={btn} onClick={() => zoomTo('fit')}>Fit</button>
      </div>
      <div ref={box} className="h-[70vh] min-h-[28rem] w-full rounded-xl border border-slate-200 bg-white" data-testid="bpmn-canvas" />
      {error && <p role="alert" className="absolute inset-x-4 top-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
    </div>
  );
}
