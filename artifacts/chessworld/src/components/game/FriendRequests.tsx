import { useState, useEffect } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useGameStore } from '../../stores/gameStore';
import { supabase } from '../../lib/supabase';
import { X, Check, XCircle, Users } from 'lucide-react';
import type { FriendRequest, Profile } from '../../types';

export function FriendRequests() {
  const { user } = useAuthStore();
  const { showFriends, toggleFriends } = useGameStore();
  const [requests, setRequests] = useState<(FriendRequest & { profile?: Profile })[]>([]);
  const [friends, setFriends] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (showFriends && user) {
      loadFriends();
    }
  }, [showFriends, user]);

  const loadFriends = async () => {
    if (!user) return;
    setLoading(true);

    const { data: pendingRequests } = await supabase
      .from('friend_requests')
      .select('*')
      .eq('receiver_id', user.id)
      .eq('status', 'pending');

    const { data: acceptedSent } = await supabase
      .from('friend_requests')
      .select('*')
      .eq('requester_id', user.id)
      .eq('status', 'accepted');

    const { data: acceptedReceived } = await supabase
      .from('friend_requests')
      .select('*')
      .eq('receiver_id', user.id)
      .eq('status', 'accepted');

    const friendIds = [
      ...(acceptedSent?.map(r => r.receiver_id) || []),
      ...(acceptedReceived?.map(r => r.requester_id) || []),
    ];

    if (friendIds.length > 0) {
      const { data: friendProfiles } = await supabase
        .from('profiles')
        .select('*')
        .in('user_id', friendIds);
      setFriends(friendProfiles || []);
    } else {
      setFriends([]);
    }

    setRequests(pendingRequests || []);
    setLoading(false);
  };

  const handleAccept = async (requestId: string) => {
    await supabase.from('friend_requests').update({
      status: 'accepted',
      updated_at: new Date().toISOString(),
    }).eq('id', requestId);
    loadFriends();
  };

  const handleReject = async (requestId: string) => {
    await supabase.from('friend_requests').update({
      status: 'rejected',
      updated_at: new Date().toISOString(),
    }).eq('id', requestId);
    loadFriends();
  };

  if (!showFriends) return null;

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
        <div className="bg-slate-900 rounded-2xl border border-slate-700 w-full max-w-sm p-8 text-center">
          <p className="text-slate-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-slate-900 rounded-2xl border border-slate-700 w-full max-w-sm overflow-hidden shadow-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <h3 className="text-white font-bold flex items-center gap-2">
            <Users className="w-5 h-5 text-amber-400" />
            Friends
          </h3>
          <button onClick={toggleFriends} className="text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Pending requests */}
          {requests.length > 0 && (
            <div>
              <h4 className="text-slate-400 text-xs font-medium uppercase mb-2">Pending Requests</h4>
              <div className="space-y-2">
                {requests.map((req) => (
                  <div key={req.id} className="flex items-center justify-between bg-slate-800 rounded-lg p-3">
                    <span className="text-white text-sm">Player Request</span>
                    <div className="flex gap-1">
                      <button onClick={() => handleAccept(req.id)} className="w-7 h-7 bg-emerald-500/20 rounded flex items-center justify-center text-emerald-400 hover:bg-emerald-500/30">
                        <Check className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleReject(req.id)} className="w-7 h-7 bg-red-500/20 rounded flex items-center justify-center text-red-400 hover:bg-red-500/30">
                        <XCircle className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Friends list */}
          <div>
            <h4 className="text-slate-400 text-xs font-medium uppercase mb-2">Friends ({friends.length})</h4>
            {friends.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-6">No friends yet. Click on other players in the world to add them!</p>
            ) : (
              <div className="space-y-2">
                {friends.map((friend) => (
                  <div key={friend.id} className="flex items-center gap-3 bg-slate-800 rounded-lg p-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center">
                      <span className="text-white text-xs font-bold">{friend.username[0].toUpperCase()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-sm font-medium truncate">{friend.username}</div>
                      <div className="text-slate-400 text-xs">{friend.rating} ELO</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
