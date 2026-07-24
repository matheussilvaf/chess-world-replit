import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { useAuthStore } from '../../stores/authStore';
import { X, Send, GripVertical, MoveDiagonal2 } from 'lucide-react';
import { usePanelPlacement } from '../../hooks/usePanelPlacement';

export function PublicChat() {
  const [message, setMessage] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const wasShownRef = useRef(false);
  const { chatMessages, showChat, toggleChat, sendChat } = useGameStore();
  const { user, profile } = useAuthStore();

  const { panelRef, style, hasCustomSize, dragging, resizing, dragHandleProps, resizeHandleProps } =
    usePanelPlacement({
      storageKey: 'chessworld.panel.chat',
      defaultWidth: 384,
      defaultHeight: 400,
      minW: 280,
      minH: 300,
      maxW: 640,
      maxH: 720,
    });

  // Always keep the newest message in view: jump instantly when the panel
  // opens, scroll smoothly when a message arrives while it's open.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!showChat || !el) {
      wasShownRef.current = false;
      return;
    }
    const justOpened = !wasShownRef.current;
    wasShownRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: justOpened ? 'auto' : 'smooth' });
  }, [showChat, chatMessages]);

  // Stay pinned to the bottom while the panel is being resized.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
  }, [style?.height]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || !user || !profile) return;
    sendChat(message, user.id, profile.username);
    setMessage('');
  };

  if (!showChat) return null;

  return (
    <div
      ref={panelRef}
      style={style}
      className={`fixed z-[500] bg-slate-900/95 backdrop-blur-sm rounded-xl border flex flex-col overflow-hidden shadow-2xl transition-colors ${
        dragging || resizing ? 'border-amber-500/60' : 'border-slate-700/50'
      } ${style ? '' : 'bottom-4 right-4'} ${hasCustomSize ? '' : 'w-80 sm:w-96 max-h-[400px]'}`}
    >
      {/* Resize handle — top-left corner */}
      <div
        {...resizeHandleProps}
        title="Drag to resize"
        className="absolute top-0 left-0 z-10 flex h-7 w-7 cursor-nwse-resize items-start justify-start p-1.5 text-slate-500 hover:text-amber-400 transition-colors"
      >
        <MoveDiagonal2 className="h-3.5 w-3.5" />
      </div>

      {/* Header — drag handle */}
      <div
        {...dragHandleProps}
        title="Drag to move"
        className={`flex shrink-0 items-center justify-between pl-8 pr-4 py-3 border-b border-slate-700/50 select-none ${
          dragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
      >
        <h3 className="flex items-center gap-1.5 text-white font-medium text-sm">
          <GripVertical className="w-3.5 h-3.5 text-slate-500" />
          Public Chat
        </h3>
        <button onClick={toggleChat} className="text-slate-400 hover:text-white transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div
        ref={listRef}
        className={`flex-1 overflow-y-auto p-3 space-y-2 ${
          hasCustomSize ? 'min-h-0' : 'max-h-[250px] min-h-[150px]'
        }`}
      >
        {chatMessages.length === 0 && (
          <p className="text-slate-500 text-sm text-center py-4">No messages yet. Say hello!</p>
        )}
        {chatMessages.map((msg) => (
          <div key={msg.id} className="flex gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-emerald-400 font-medium text-xs truncate">{msg.username}</span>
                <span className="text-slate-600 text-[10px]">
                  {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p className="text-white/90 text-sm break-words">{msg.message}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="shrink-0 p-3 border-t border-slate-700/50 flex gap-2">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type a message..."
          maxLength={200}
          className="flex-1 min-w-0 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
        />
        <button
          type="submit"
          disabled={!message.trim()}
          className="w-9 h-9 shrink-0 bg-amber-500 rounded-lg flex items-center justify-center text-white hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
