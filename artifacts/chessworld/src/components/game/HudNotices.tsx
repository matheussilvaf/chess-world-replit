import { Bell } from 'lucide-react';
import { useNoticesStore } from '../../stores/noticesStore';

export function HudNotices() {
  const { notices, dismiss } = useNoticesStore();
  return (
    <div className="pointer-events-none fixed left-1/2 top-16 z-[300] flex w-[calc(100%-1rem)] max-w-sm -translate-x-1/2 flex-col gap-2">
      {notices.map((notice) => (
        <div
          key={notice.id}
          className="pointer-events-auto w-full rounded-xl border border-amber-400/30 bg-slate-950/95 p-3 shadow-xl backdrop-blur"
        >
          <button type="button" onClick={() => { notice.onClick?.(); dismiss(notice.id); }} className="flex w-full items-start gap-3 text-left">
            <Bell className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-white">{notice.title}</span>
              {notice.body && <span className="block text-xs text-slate-300">{notice.body}</span>}
            </span>
          </button>
          {!!notice.actions?.length && <div className="mt-2 flex flex-wrap gap-2 pl-7">{notice.actions.map((action) => <button key={action.label} type="button" onClick={() => { action.onClick(); dismiss(notice.id); }} className={`rounded-md px-2 py-1 text-xs font-semibold ${action.variant === 'danger' ? 'bg-red-900 text-red-100' : action.variant === 'primary' ? 'bg-amber-500 text-black' : 'bg-slate-700 text-white'}`}>{action.label}</button>)}</div>}
        </div>
      ))}
    </div>
  );
}