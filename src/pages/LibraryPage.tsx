import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { UserPlus, Check, Users, ArrowLeft, Award, List, Plus, Trash2, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { posterUrl } from '../lib/tmdb'
import { useAuth } from '../context/AuthContext'
import { ProfileView } from '../components/profile/ProfileView'
import type { CustomList, FavoritePin, MediaLog, Profile } from '../types/database'
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
    const { user, profile, refreshProfile } = useAuth()
    const { userId } = useParams<{ userId?: string }>()
    const navigate = useNavigate()

    const [friendUsername, setFriendUsername] = useState('')
    const [friendStatus, setFriendStatus] = useState<string | null>(null)
    const [pending, setPending] = useState<PendingRequest[]>([])

    const [targetProfile, setTargetProfile] = useState<Profile | null>(null)
    const [customLists, setCustomLists] = useState<CustomList[]>([])
    const [newListTitle, setNewListTitle] = useState('')
    const [newListCollab, setNewListCollab] = useState(true)
    const [creatingList, setCreatingList] = useState(false)

    const targetUserId = userId || user?.id || ''
    const isOwnProfile = Boolean(user && targetUserId === user.id)

    const loadFavoritesAndLists = useCallback(async () => {
        if (!targetUserId) return

        const [{ data: profRow }, { data: listRows }] = await Promise.all([
            supabase.from('profiles').select('*').eq('id', targetUserId).single(),
            supabase
                .from('custom_lists')
                .select('*, items:custom_list_items(*)')
                .eq('owner_id', targetUserId)
                .order('created_at', { ascending: false }),
        ])

        if (profRow) setTargetProfile(profRow as Profile)
        if (listRows) setCustomLists(listRows as CustomList[])
    }, [targetUserId])

    useEffect(() => {
        void loadFavoritesAndLists()
    }, [loadFavoritesAndLists, profile?.top_favorites, myLogs])

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

    async function handleUnpinFavorite(pin: FavoritePin) {
        if (!user || !isOwnProfile) return
        const current = Array.isArray(profile?.top_favorites) ? profile.top_favorites : []
        const next = current.filter(
            (p) => !(p.tmdb_id === pin.tmdb_id && p.media_type === pin.media_type)
        )
        await supabase.from('profiles').update({ top_favorites: next }).eq('id', user.id)
        await refreshProfile()
        await loadFavoritesAndLists()
    }

    async function handleCreateList(e: React.FormEvent) {
        e.preventDefault()
        if (!user || !newListTitle.trim()) return
        setCreatingList(true)
        await supabase.from('custom_lists').insert({
            owner_id: user.id,
            title: newListTitle.trim(),
            is_collaborative: newListCollab,
        })
        setCreatingList(false)
        setNewListTitle('')
        await loadFavoritesAndLists()
    }

    async function handleDeleteList(listId: string) {
        if (!user) return
        await supabase.from('custom_lists').delete().eq('id', listId).eq('owner_id', user.id)
        await loadFavoritesAndLists()
    }

    async function handleRemoveListItem(itemId: string) {
        await supabase.from('custom_list_items').delete().eq('id', itemId)
        await loadFavoritesAndLists()
    }

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

    const mergedLogsMap = new Map<string, MediaLog>()
    for (const log of feedLogs) mergedLogsMap.set(log.id, log)
    for (const log of myLogs) mergedLogsMap.set(log.id, log)
    const combinedLogs = Array.from(mergedLogsMap.values())

    const topFavorites: FavoritePin[] = Array.isArray(
        isOwnProfile ? profile?.top_favorites : targetProfile?.top_favorites
    )
        ? ((isOwnProfile ? profile?.top_favorites : targetProfile?.top_favorites) as FavoritePin[])
        : []

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
                onProfileUpdated={() => {
                    void refreshProfile()
                    void loadFavoritesAndLists()
                    onFriendsUpdated()
                }}
            />

            {/* Top 4 Pinned Favorites Showcase */}
            {(topFavorites.length > 0 || isOwnProfile) && (
                <section className="bg-[#18181F] border border-white/10 rounded-2xl p-4 sm:p-5 space-y-3">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                            <Award className="w-3.5 h-3.5 text-amber-400" /> Top 4 Favorites ({topFavorites.length}/4)
                        </h2>
                        {isOwnProfile && (
                            <span className="text-[11px] text-zinc-500">
                                Open any movie/show and click &ldquo;Pin to Top 4&rdquo;
                            </span>
                        )}
                    </div>

                    {topFavorites.length === 0 ? (
                        <p className="text-xs text-zinc-500">
                            No favorites pinned yet. Pin up to 4 all-time favorites to showcase at the top of your profile!
                        </p>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {topFavorites.map((pin) => (
                                <div
                                    key={`${pin.media_type}-${pin.tmdb_id}`}
                                    className="relative group bg-[#14141A] border border-white/10 rounded-xl overflow-hidden"
                                >
                                    <button
                                        type="button"
                                        onClick={() =>
                                            onOpenMedia({
                                                tmdb_id: pin.tmdb_id,
                                                media_type: pin.media_type,
                                                title: pin.title,
                                                poster_path: pin.poster_path,
                                            })
                                        }
                                        className="w-full text-left cursor-pointer block"
                                    >
                                        {pin.poster_path ? (
                                            <img
                                                src={posterUrl(pin.poster_path, 'w342')}
                                                alt={pin.title}
                                                className="w-full aspect-[2/3] object-cover group-hover:scale-105 transition duration-300"
                                            />
                                        ) : (
                                            <div className="w-full aspect-[2/3] bg-[#22222C]" />
                                        )}
                                        <div className="p-2">
                                            <p className="text-xs font-bold text-white truncate">{pin.title}</p>
                                            <p className="text-[10px] text-zinc-400 uppercase">{pin.media_type}</p>
                                        </div>
                                    </button>

                                    {isOwnProfile && (
                                        <button
                                            type="button"
                                            onClick={() => handleUnpinFavorite(pin)}
                                            title="Unpin from Top 4"
                                            className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/75 hover:bg-red-500 text-white flex items-center justify-center transition cursor-pointer"
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            )}

            {/* Custom & Collaborative Lists */}
            {(customLists.length > 0 || isOwnProfile) && (
                <section className="bg-[#18181F] border border-white/10 rounded-2xl p-4 sm:p-5 space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                            <List className="w-3.5 h-3.5 text-[#FF9F43]" /> Custom Lists ({customLists.length})
                        </h2>
                    </div>

                    {isOwnProfile && (
                        <form onSubmit={handleCreateList} className="flex flex-col sm:flex-row gap-2">
                            <input
                                type="text"
                                placeholder="New list name (e.g., Late Night Horror, Watch With Friends)..."
                                value={newListTitle}
                                onChange={(e) => setNewListTitle(e.target.value)}
                                className="flex-1 bg-[#22222C] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#FF6B4A]"
                            />
                            <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#22222C] border border-white/10 text-xs text-zinc-300 cursor-pointer shrink-0">
                                <input
                                    type="checkbox"
                                    checked={newListCollab}
                                    onChange={(e) => setNewListCollab(e.target.checked)}
                                    className="accent-[#FF6B4A]"
                                />
                                Shared list
                            </label>
                            <button
                                type="submit"
                                disabled={creatingList || !newListTitle.trim()}
                                className="px-4 py-2 rounded-xl bg-[#FF6B4A] hover:bg-[#FF9F43] text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-40 shrink-0"
                            >
                                <Plus className="w-3.5 h-3.5" /> Create List
                            </button>
                        </form>
                    )}

                    {customLists.length === 0 ? (
                        <p className="text-xs text-zinc-500">
                            Create a custom list above, then open any title to add movies or shows to it.
                        </p>
                    ) : (
                        <div className="space-y-3">
                            {customLists.map((list) => (
                                <div
                                    key={list.id}
                                    className="bg-[#14141A] border border-white/10 rounded-xl p-3.5 space-y-2.5"
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <h3 className="text-sm font-bold text-white truncate">{list.title}</h3>
                                            {list.is_collaborative && (
                                                <span className="px-2 py-0.5 rounded-md bg-[#FF6B4A]/15 text-[#FF9F43] text-[10px] font-semibold">
                                                    Shared
                                                </span>
                                            )}
                                        </div>
                                        {isOwnProfile && (
                                            <button
                                                type="button"
                                                onClick={() => handleDeleteList(list.id)}
                                                className="text-zinc-500 hover:text-red-400 cursor-pointer p-1"
                                                title="Delete list"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        )}
                                    </div>

                                    {!list.items || list.items.length === 0 ? (
                                        <p className="text-[11px] text-zinc-500">
                                            No titles in this list yet. Open any movie or show and click &ldquo;Add to List&rdquo;.
                                        </p>
                                    ) : (
                                        <div className="flex gap-2.5 overflow-x-auto pb-1">
                                            {list.items.map((item) => (
                                                <div
                                                    key={item.id}
                                                    className="relative w-24 shrink-0 bg-[#18181F] border border-white/10 rounded-lg overflow-hidden group"
                                                >
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            onOpenMedia({
                                                                tmdb_id: item.tmdb_id,
                                                                media_type: item.media_type,
                                                                title: item.title,
                                                                poster_path: item.poster_path,
                                                            })
                                                        }
                                                        className="w-full text-left cursor-pointer block"
                                                    >
                                                        {item.poster_path ? (
                                                            <img
                                                                src={posterUrl(item.poster_path, 'w185')}
                                                                alt={item.title}
                                                                className="w-full aspect-[2/3] object-cover"
                                                            />
                                                        ) : (
                                                            <div className="w-full aspect-[2/3] bg-[#22222C]" />
                                                        )}
                                                        <p className="p-1.5 text-[10px] font-semibold text-white truncate">
                                                            {item.title}
                                                        </p>
                                                    </button>
                                                    {(isOwnProfile || item.added_by === user.id) && (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleRemoveListItem(item.id)}
                                                            className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/75 hover:bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition cursor-pointer"
                                                        >
                                                            <X className="w-3 h-3" />
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            )}

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