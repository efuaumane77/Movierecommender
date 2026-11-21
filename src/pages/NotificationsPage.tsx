import { Heart, Check, UserPlus } from 'lucide-react'
import type { MediaLog, Profile } from '../types/database'

export interface IncomingRequest {
    id: string
    requester: Profile
}

interface NotificationsPageProps {
    incomingRequests: IncomingRequest[]
    friendLogs: MediaLog[]
    onAcceptRequest: (friendshipId: string) => Promise<void>
}

export function NotificationsPage({
                                      incomingRequests,
                                      friendLogs,
                                      onAcceptRequest,
                                  }: NotificationsPageProps) {
    return (
        <div className="space-y-6">
            <h1 className="text-lg font-bold flex items-center gap-2">
                <Heart className="w-5 h-5 text-[#FF6B4A]" /> Notifications
            </h1>

            {/* Incoming Follow Requests */}
            <section className="bg-[#18181F] border border-white/10 rounded-2xl p-4 space-y-3">
                <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                    <UserPlus className="w-3.5 h-3.5 text-[#FF9F43]" /> Follow Requests ({incomingRequests.length})
                </h2>

                {incomingRequests.length === 0 ? (
                    <p className="text-xs text-zinc-500">No pending follow requests.</p>
                ) : (
                    <div className="space-y-2">
                        {incomingRequests.map((req) => (
                            <div
                                key={req.id}
                                className="flex items-center justify-between bg-[#22222C] px-3.5 py-2.5 rounded-xl"
                            >
                                <div className="flex items-center gap-2.5">
                                    <div className="w-8 h-8 rounded-full bg-[#18181F] flex items-center justify-center text-xs font-bold uppercase text-[#FF6B4A]">
                                        {req.requester.username[0]}
                                    </div>
                                    <span className="text-xs font-semibold text-white">
                    @{req.requester.username}{' '}
                                        <span className="font-normal text-zinc-400">requested to follow you</span>
                  </span>
                                </div>

                                <button
                                    type="button"
                                    onClick={() => onAcceptRequest(req.id)}
                                    className="px-3 py-1.5 rounded-lg bg-[#FF6B4A] hover:bg-[#FF9F43] text-white text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
                                >
                                    <Check className="w-3.5 h-3.5" /> Confirm
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* Recent Friend Watches */}
            <section className="bg-[#18181F] border border-white/10 rounded-2xl p-4 space-y-3">
                <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                    Recent Activity
                </h2>

                {friendLogs.length === 0 ? (
                    <p className="text-xs text-zinc-500">No friend activity yet.</p>
                ) : (
                    <div className="space-y-2.5">
                        {friendLogs.slice(0, 15).map((log) => (
                            <div
                                key={log.id}
                                className="flex items-center justify-between text-xs border-b border-white/5 pb-2.5 last:border-0 last:pb-0"
                            >
                                <p className="text-zinc-300">
                                    <strong className="text-white">@{log.profiles?.username ?? 'friend'}</strong>{' '}
                                    {log.status === 'watched'
                                        ? 'finished'
                                        : log.status === 'watching'
                                            ? 'is watching'
                                            : 'saved'}{' '}
                                    <strong className="text-[#FF9F43]">{log.title}</strong>
                                </p>
                                <span className="text-[11px] text-zinc-500 shrink-0 ml-2">
                  {new Date(log.updated_at).toLocaleDateString()}
                </span>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    )
}