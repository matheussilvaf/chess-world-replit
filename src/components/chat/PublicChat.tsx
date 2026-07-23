import { useState, useRef, useEffect } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { useAuthStore } from '../../stores/authStore';
import { X, Send } from 'lucide-react';

export function PublicChat() {
  const [message, setMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { chatMessages, showChat, toggleChat, sendChat } = useGameStore();
  const { user, profile } = useAuthStore();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || !user || !profile) return;
    sendChat(message, user.id, profile.username);
    setMessage('');
  };

  if (!showChat) return null;

  return (
    <div className="absolute bottom-4 left-4 z-40 w-80 sm:w-96 max-h-[400px] bg-slate-900/95 backdrop-blur-sm rounded-xl border border-slate-700/50 flex flex-col overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50">
        <h3 className="text-white font-medium text-sm">Public Chat</h3>
        <button onClick={toggleChat} className="text-slate-400 hover:text-white transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 max-h-[250px] min-h-[150px]">
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
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="p-3 border-t border-slate-700/50 flex gap-2">
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type a message..."
          maxLength={200}
          className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
        />
        <button
          type="submit"
          disabled={!message.trim()}
          className="w-9 h-9 bg-amber-500 rounded-lg flex items-center justify-center text-white hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
