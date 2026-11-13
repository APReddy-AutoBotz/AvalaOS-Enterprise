// The BPMN canvas (bpmn-js), loaded only when someone edits the flow. It holds the drawing until the
// person saves; the model changes only after they confirm the listed changes.
import React from 'react';
import Modeler from 'bpmn-js/lib/Modeler';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';

export interface CanvasApi { save(): Promise<string>; load(xml: string): Promise<void>; fit(): void }

export default function BpmnCanvas({ xml, onReady, onChange }: { xml: string; onReady: (api: CanvasApi) => void; onChange: () => void }) {
  const box = React.useRef<HTMLDivElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    const modeler: any = new (Modeler as any)({ container: box.current!, keyboard: { bindTo: document } });
    const fit = () => { try { modeler.get('canvas').zoom('fit-viewport', 'auto'); } catch { /* not rendered yet */ } };
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
  return (
    <div className="relative">
      <div ref={box} className="h-[70vh] min-h-[28rem] w-full rounded-xl border border-slate-200 bg-white" data-testid="bpmn-canvas" />
      {error && <p role="alert" className="absolute inset-x-4 top-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
    </div>
  );
}
