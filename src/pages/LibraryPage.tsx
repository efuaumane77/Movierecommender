import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { UserPlus, Check, Users, ArrowLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { ProfileView } from '../components/profile/ProfileView'
import type { MediaLog, Profile } from '../types/database'
import type { SelectedMedia } from '../components/media/MediaModal'

interface LibraryPageProps {
    feedLogs: MediaLog[]
    myLogs: MediaLog[]
    friends: Profile[]
    friendIds: Set<string>
    outgoingRequestIds: Set<string>
    onFollowUser: (targetUserId: string) => Promise<void>
    onOpenMedia: (media: SelectedMedia) => void
    onLogsUpdated: () => void
    onFriendsUpdated: () => void
}

interface PendingRequest {
    id: string
    requester: Profile
}

export function LibraryPage({
                                feedLogs,
                                myLogs,
                                friends,
                                friendIds,
                                outgoingRequestIds,
                                onFollowUser,
                                onOpenMedia,
                                onLogsUpdated,
                                onFriendsUpdated,
                            }: LibraryPageProps) {
    const { user } = useAuth()
    const { userId } = useParams<{ userId?: string }>()
    const navigate = useNavigate()

    const [friendUsername, setFriendUsername] = useState('')
    const [friendStatus, setFriendStatus] = useState<string | null>(null)
    const [pending, setPending] = useState<PendingRequest[]>([])

    const targetUserId = userId || user?.id || ''
    const isOwnProfile = Boolean(user && targetUserId === user.id)

    useEffect(() => {
        if (!user || !isOwnProfile) return
        supabase
            .from('friendships')
            .select(
                'id, requester:profiles!friendships_requester_id_fkey(id, username, display_name, avatar_url, created_at)'
            )
            .eq('addressee_id', user.id)
            .eq('status', 'pending')
            .then(({ data }) => {
                if (data) setPending(data as unknown as PendingRequest[])
            })
    }, [user, friends, isOwnProfile])

    async function handleAddFriend(e: React.FormEvent) {
        e.preventDefault()
        if (!user || !friendUsername.trim()) return
        setFriendStatus(null)

        const cleanName = friendUsername.trim().toLowerCase().replace(/^@/, '')
        const { data: target } = await supabase
            .from('profiles')
            .select('id, username')
            .eq('username', cleanName)
            .single()

        if (!target) {
            setFriendStatus(`No user found with @${cleanName}`)
            return
        }
        if (target.id === user.id) {
            setFriendStatus("You can't add yourself!")
            return
        }

        const { error } = await supabase.from('friendships').insert({
            requester_id: user.id,
            addressee_id: target.id,
        })

        if (error) {
            setFriendStatus('Request already sent or you are already friends.')
        } else {
            setFriendStatus(`Friend request sent to @${target.username}!`)
            setFriendUsername('')
            onFriendsUpdated()
        }
    }

    async function handleAccept(friendshipId: string) {
        await supabase.from('friendships').update({ status: 'accepted' }).eq('id', friendshipId)
        setPending((prev) => prev.filter((p) => p.id !== friendshipId))
        onFriendsUpdated()
    }

    if (!user) return null

    // Merge feedLogs and myLogs without duplicates so every user's Watched/Watchlist/Reviews are available
    const mergedLogsMap = new Map<string, MediaLog>()
    for (const log of feedLogs) mergedLogsMap.set(log.id, log)
    for (const log of myLogs) mergedLogsMap.set(log.id, log)
    const combinedLogs = Array.from(mergedLogsMap.values())

    return (
        <div className="space-y-6">
            {!isOwnProfile && (
                <button
                    type="button"
                    onClick={() => navigate(-1)}
                    className="text-xs font-semibold text-zinc-300 hover:text-[#FF9F43] inline-flex items-center gap-1.5 transition cursor-pointer"
                >
                    <ArrowLeft className="w-3.5 h-3.5" /> Back
                </button>
            )}

            {/* Clean Instagram-Inspired Profile Header + Watched / Watchlist / Reviews Tabs */}
            <ProfileView
                targetUserId={targetUserId}
                allLogs={combinedLogs}
                myLogs={myLogs}
                friendIds={friendIds}
                outgoingRequestIds={outgoingRequestIds}
                onFollowUser={onFollowUser}
                onOpenMedia={onOpenMedia}
                onSelectUserProfile={(clickedId) => {
                    if (clickedId === user.id) navigate('/library')
                    else navigate(`/profile/${clickedId}`)
                }}
                onLogsUpdated={onLogsUpdated}
                onProfileUpdated={onFriendsUpdated}
            />

            {/* Quick Find / Incoming Requests Card on Your Own Profile */}
            {isOwnProfile && (
                <section className="bg-[#18181F] border border-white/10 rounded-2xl p-4 sm:p-5 space-y-3.5">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                            <Users className="w-3.5 h-3.5 text-[#FF6B4A]" /> Find Friends & Requests
                        </h2>
                    </div>

                    <form onSubmit={handleAddFriend} className="flex gap-2">
                        <input
                            type="text"
                            placeholder="Send follow request by @username..."
                            value={friendUsername}
                            onChange={(e) => setFriendUsername(e.target.value)}
                            className="flex-1 bg-[#22222C] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#FF6B4A]"
                        />
                        <button
                            type="submit"
                            className="px-4 py-2 rounded-xl bg-[#FF6B4A] hover:bg-[#FF9F43] text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shrink-0"
                        >
                            <UserPlus className="w-3.5 h-3.5" /> Add
                        </button>
                    </form>

                    {friendStatus && <p className="text-xs text-[#FF9F43]">{friendStatus}</p>}

                    {pending.length > 0 && (
                        <div className="space-y-2 pt-2 border-t border-white/10">
                            <p className="text-[11px] uppercase tracking-wider text-zinc-400 font-semibold">
                                Pending Requests ({pending.length})
                            </p>
                            {pending.map((req) => (
                                <div
                                    key={req.id}
                                    className="flex items-center justify-between bg-[#22222C] px-3 py-2 rounded-xl"
                                >
                                    <button
                                        type="button"
                                        onClick={() => navigate(`/profile/${req.requester.id}`)}
                                        className="text-xs font-semibold text-white hover:text-[#FF9F43] cursor-pointer"
                                    >
                                        @{req.requester.username}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleAccept(req.id)}
                                        className="px-3 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-white text-xs font-semibold flex items-center gap-1 transition cursor-pointer"
                                    >
                                        <Check className="w-3 h-3" /> Accept
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            )}
        </div>
    )
}