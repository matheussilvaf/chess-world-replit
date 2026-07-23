import { useState } from 'react';
import { Bug, ChevronDown, ChevronRight } from 'lucide-react';

interface Props {
  diagnostics: any;
  engineStatus: any;
}

export function DiagnosticsSection({ diagnostics, engineStatus }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="card">
      <button
        onClick={() => setExpanded(!expanded)}
        className="card-header w-full cursor-pointer hover:bg-slate-800/30 transition-colors"
      >
        <Bug className="w-5 h-5 text-slate-500" />
        <h2 className="text-base font-semibold text-slate-400">Diagnostics</h2>
        {expanded ? <ChevronDown className="w-4 h-4 ml-auto text-slate-500" /> : <ChevronRight className="w-4 h-4 ml-auto text-slate-500" />}
      </button>

      {expanded && (
        <div className="p-4 space-y-4 text-xs font-mono">
          {/* Engine Info */}
          <div>
            <p className="text-slate-500 font-semibold mb-1">Engine</p>
            <pre className="bg-slate-900 rounded p-2 text-slate-400 overflow-x-auto">
              {JSON.stringify(engineStatus, null, 2)}
            </pre>
          </div>

          {diagnostics && (
            <>
              {/* Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <InfoBox label="Round" value={diagnostics.roundRequested} />
                <InfoBox label="Active Players" value={diagnostics.activePlayers} />
                <InfoBox label="Expected Pairings" value={diagnostics.expectedPairings} />
                <InfoBox label="Expected Byes" value={diagnostics.expectedByes} />
              </div>

              {/* Violations */}
              {diagnostics.violations?.length > 0 && (
                <div>
                  <p className="text-red-400 font-semibold mb-1">Violations</p>
                  <ul className="list-disc list-inside text-red-300">
                    {diagnostics.violations.map((v: string, i: number) => <li key={i}>{v}</li>)}
                  </ul>
                </div>
              )}

              {/* Color Warnings */}
              {diagnostics.colorWarnings?.length > 0 && (
                <div>
                  <p className="text-amber-400 font-semibold mb-1">Color Warnings</p>
                  <ul className="list-disc list-inside text-amber-300">
                    {diagnostics.colorWarnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
                  </ul>
                </div>
              )}

              {/* Errors */}
              {diagnostics.errors?.length > 0 && (
                <div>
                  <p className="text-red-400 font-semibold mb-1">Errors</p>
                  <ul className="list-disc list-inside text-red-300">
                    {diagnostics.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}

              {/* TRF Input */}
              <div>
                <p className="text-slate-500 font-semibold mb-1">TRF Input</p>
                <pre className="bg-slate-900 rounded p-2 text-slate-400 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre">
                  {diagnostics.trfInput || '(empty)'}
                </pre>
              </div>

              {/* Engine Output */}
              <div>
                <p className="text-slate-500 font-semibold mb-1">Engine Output</p>
                <pre className="bg-slate-900 rounded p-2 text-slate-400 overflow-x-auto">
                  {diagnostics.engineOutput || '(empty)'}
                </pre>
              </div>

              {/* Checker Output */}
              {diagnostics.checkerOutput && (
                <div>
                  <p className="text-slate-500 font-semibold mb-1">Checker Output</p>
                  <pre className="bg-slate-900 rounded p-2 text-slate-400 overflow-x-auto">
                    {diagnostics.checkerOutput}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function InfoBox({ label, value }: { label: string; value: any }) {
  return (
    <div className="bg-slate-900 rounded p-2">
      <p className="text-slate-500 text-[10px] uppercase">{label}</p>
      <p className="text-slate-300 font-bold">{value ?? '-'}</p>
    </div>
  );
}
