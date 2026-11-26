import { useState } from 'react'
import { Heart, Check, UserPlus } from 'lucide-react'
import type { AcceptedFollowNotification, MediaLog, Profile } from '../types/database'

export interface IncomingRequest {
    id: string
    requester: Profile
}

interface NotificationsPageProps {
    incomingRequests: IncomingRequest[]
    acceptedNotifications: AcceptedFollowNotification[]
    friendLogs: MediaLog[]
    friendIds: Set<string>
    outgoingRequestIds: Set<string>
    onFollowUser: (targetUserId: string) => Promise<void>
    onAcceptRequest: (friendshipId: string) => Promise<void>
}

export function NotificationsPage({
                                      incomingRequests,
                                      acceptedNotifications,
                                      friendLogs,
                                      friendIds,
                                      outgoingRequestIds,
                                      onFollowUser,
                                      onAcceptRequest,
                                  }: NotificationsPageProps) {
    const [pendingActionId, setPendingActionId] = useState<string | null>(null)

    async function handleConfirm(id: string) {
        setPendingActionId(id)
        try {
            await onAcceptRequest(id)
        } finally {
            setPendingActionId(null)
        }
    }

    async function handleFollowBack(targetUserId: string) {
        setPendingActionId(targetUserId)
        try {
            await onFollowUser(targetUserId)
        } finally {
            setPendingActionId(null)
        }
    }

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
                                className="flex items-center justify-between bg-[#22222C] px-3.5 py-2.5 rounded-xl gap-2"
                            >
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="w-8 h-8 rounded-full bg-[#18181F] flex items-center justify-center text-xs font-bold uppercase text-[#FF6B4A] shrink-0">
                                        {req.requester.username[0]}
                                    </div>
                                    <span className="text-xs font-semibold text-white truncate">
                                        @{req.requester.username}{' '}
                                        <span className="font-normal text-zinc-400">requested to follow you</span>
                                    </span>
                                </div>

                                <button
                                    type="button"
                                    disabled={pendingActionId === req.id}
                                    onClick={() => handleConfirm(req.id)}
                                    className="px-3 py-1.5 rounded-lg bg-[#FF6B4A] hover:bg-[#FF9F43] disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1 transition cursor-pointer shrink-0"
                                >
                                    <Check className="w-3.5 h-3.5" />
                                    {pendingActionId === req.id ? 'Confirming...' : 'Confirm'}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* Accepted Follow Updates & Follow Back */}
            <section className="bg-[#18181F] border border-white/10 rounded-2xl p-4 space-y-3">
                <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                    Follow Updates ({acceptedNotifications.length})
                </h2>

                {acceptedNotifications.length === 0 ? (
                    <p className="text-xs text-zinc-500">No accepted follow updates yet.</p>
                ) : (
                    <div className="space-y-2">
                        {acceptedNotifications.map((item) => {
                            const otherId = item.otherUser.id
                            const alreadyFollowing = friendIds.has(otherId)
                            const alreadyRequested = outgoingRequestIds.has(otherId)
                            const isBusy = pendingActionId === otherId

                            return (
                                <div
                                    key={item.id}
                                    className="flex items-center justify-between bg-[#22222C] px-3.5 py-2.5 rounded-xl gap-2"
                                >
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        <div className="w-8 h-8 rounded-full bg-[#18181F] flex items-center justify-center text-xs font-bold uppercase text-[#FF9F43] shrink-0">
                                            {item.otherUser.username[0]}
                                        </div>
                                        <span className="text-xs font-semibold text-white truncate">
                                            @{item.otherUser.username}{' '}
                                            <span className="font-normal text-zinc-400">
                                                {item.direction === 'they_accepted_you'
                                                    ? 'accepted your follow request'
                                                    : '— you accepted their follow request'}
                                            </span>
                                        </span>
                                    </div>

                                    {alreadyFollowing ? (
                                        <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-400 text-[11px] font-semibold flex items-center gap-1 shrink-0">
                                            <Check className="w-3 h-3" /> Following
                                        </span>
                                    ) : alreadyRequested ? (
                                        <span className="px-2.5 py-1 rounded-lg bg-[#18181F] text-zinc-400 text-[11px] font-semibold shrink-0">
                                            Requested
                                        </span>
                                    ) : (
                                        <button
                                            type="button"
                                            disabled={isBusy}
                                            onClick={() => handleFollowBack(otherId)}
                                            className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-[#FF6B4A] to-[#FF9F43] hover:opacity-95 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1 transition cursor-pointer shrink-0"
                                        >
                                            <UserPlus className="w-3.5 h-3.5" />
                                            {isBusy ? 'Sending...' : 'Follow Back'}
                                        </button>
                                    )}
                                </div>
                            )
                        })}
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