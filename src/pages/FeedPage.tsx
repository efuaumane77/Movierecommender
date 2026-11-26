import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    Flame,
    Send,
    Check,
    Hash,
    Users,
    Sparkles,
    Play,
    Plus,
    Bookmark,
    Star,
    ArrowRight,
    MessageSquare,
    Wand2,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { getTrending, posterUrl, type TMDBSearchResult } from '../lib/tmdb'
import {
    getPersonalizedRecommendations,
    type RecommendedItem,
} from '../lib/recommendations'
import { GENRE_FORUMS } from '../lib/forums'
import { FeedCard } from '../components/feed/FeedCard'
import { TrailerPreviewModal } from '../components/media/TrailerPreviewModal'
import type { MediaLog, Profile } from '../types/database'
import type { SelectedMedia } from '../components/media/MediaModal'

interface FeedPageProps {
    feedLogs: MediaLog[]
    myLogs: MediaLog[]
    friends?: Profile[]
    joinedForumSlugs?: string[]
    onOpenMedia?: (media: SelectedMedia) => void
    onJoinOrOpenForum?: (slug: string) => void
    onLogsUpdated?: () => void
}

type FeedFilter = 'all' | 'friends' | 'reviews' | 'watching'

async function shareReviewToFriend(
    senderId: string,
    receiverId: string,
    log: MediaLog
) {
    const payload = JSON.stringify({
        author: log.profiles?.username ?? 'user',
        rating: log.rating,
        snippet: log.review_text ?? '',
        note: '',
    })
    await supabase.from('messages').insert({
        sender_id: senderId,
        receiver_id: receiverId,
        content: `__REVIEW__::${payload}`,
        attached_tmdb_id: log.tmdb_id,
        attached_media_type: log.media_type,
        attached_title: log.title,
        attached_poster: log.poster_path,
    })
}

async function shareReviewToForum(
    senderId: string,
    forumSlug: string,
    log: MediaLog
) {
    const payload = JSON.stringify({
        author: log.profiles?.username ?? 'user',
        rating: log.rating,
        snippet: log.review_text ?? '',
        note: '',
    })
    await supabase.from('forum_messages').insert({
        forum_slug: forumSlug,
        sender_id: senderId,
        content: `__REVIEW__::${payload}`,
        attached_tmdb_id: log.tmdb_id,
        attached_media_type: log.media_type,
        attached_title: log.title,
        attached_poster: log.poster_path,
    })
}

export function FeedPage({
                             feedLogs,
                             myLogs,
                             friends = [],
                             joinedForumSlugs = [],
                             onOpenMedia,
                             onJoinOrOpenForum,
                             onLogsUpdated,
                         }: FeedPageProps) {
    const { user, profile } = useAuth()
    const navigate = useNavigate()

    const [trending, setTrending] = useState<TMDBSearchResult[]>([])
    const [loadingTrending, setLoadingTrending] = useState(true)
    const [recommendations, setRecommendations] = useState<RecommendedItem[]>([])
    const [loadingRecs, setLoadingRecs] = useState(true)
    const [feedFilter, setFeedFilter] = useState<FeedFilter>('all')
    const [togglingKey, setTogglingKey] = useState<string | null>(null)
    const [previewMedia, setPreviewMedia] = useState<SelectedMedia | null>(null)

    const [openShareLogId, setOpenShareLogId] = useState<string | null>(null)
    const [sentFeedback, setSentFeedback] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        getTrending(1)
            .then((items) => {
                if (!cancelled) setTrending(items.slice(0, 10))
            })
            .catch(console.error)
            .finally(() => {
                if (!cancelled) setLoadingTrending(false)
            })
        return () => {
            cancelled = true
        }
    }, [])

    const friendIds = useMemo(() => new Set(friends.map((f) => f.id)), [friends])

    useEffect(() => {
        if (!user) return
        let cancelled = false
        setLoadingRecs(true)

        getPersonalizedRecommendations({
            userId: user.id,
            profile,
            myLogs,
            feedLogs,
            friendIds,
        })
            .then((items) => {
                if (!cancelled) setRecommendations(items)
            })
            .catch(console.error)
            .finally(() => {
                if (!cancelled) setLoadingRecs(false)
            })

        return () => {
            cancelled = true
        }
    }, [user, profile, myLogs, feedLogs, friendIds])

    const joinedForums = useMemo(
        () => GENRE_FORUMS.filter((f) => joinedForumSlugs.includes(f.slug)),
        [joinedForumSlugs]
    )

    const myWatchlistKeys = useMemo(() => {
        const set = new Set<string>()
        for (const l of myLogs) {
            if (l.status === 'watchlist') set.add(`${l.media_type}-${l.tmdb_id}`)
        }
        return set
    }, [myLogs])

    const filteredLogs = useMemo(() => {
        return feedLogs.filter((log) => {
            if (feedFilter === 'friends') {
                return friendIds.has(log.user_id) || log.user_id === user?.id
            }
            if (feedFilter === 'reviews') {
                return Boolean(log.review_text && log.review_text.trim().length > 0)
            }
            if (feedFilter === 'watching') {
                return log.status === 'watching'
            }
            return true
        })
    }, [feedLogs, feedFilter, friendIds, user?.id])

    async function handleToggleWatchlistItem(item: {
        tmdb_id: number
        media_type: 'movie' | 'tv'
        title: string
        poster_path: string | null
    }) {
        if (!user) return
        const key = `${item.media_type}-${item.tmdb_id}`
        setTogglingKey(key)

        try {
            const existing = myLogs.find(
                (l) => l.tmdb_id === item.tmdb_id && l.media_type === item.media_type
            )
            if (existing && existing.status === 'watchlist') {
                await supabase.from('media_logs').delete().eq('id', existing.id)
            } else if (existing) {
                await supabase
                    .from('media_logs')
                    .update({ status: 'watchlist', updated_at: new Date().toISOString() })
                    .eq('id', existing.id)
            } else {
                await supabase.from('media_logs').insert({
                    user_id: user.id,
                    tmdb_id: item.tmdb_id,
                    media_type: item.media_type,
                    title: item.title,
                    poster_path: item.poster_path,
                    status: 'watchlist',
                })
            }
            onLogsUpdated?.()
        } finally {
            setTogglingKey(null)
        }
    }

    function notifySent(label: string) {
        setSentFeedback(label)
        setTimeout(() => {
            setSentFeedback(null)
            setOpenShareLogId(null)
        }, 1200)
    }

    const greetingName = profile?.display_name || profile?.username || 'there'

    return (
        <div className="space-y-6">
            {/* Quick Status & Log Prompt Strip */}
            <section className="bg-gradient-to-r from-[#18181F] via-[#1C1C26] to-[#18181F] border border-white/10 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    {profile?.avatar_url ? (
                        <img
                            src={profile.avatar_url}
                            alt={greetingName}
                            className="w-10 h-10 rounded-full object-cover border border-[#FF6B4A]/50 shrink-0"
                        />
                    ) : (
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#FF6B4A] to-[#FF9F43] flex items-center justify-center text-sm font-bold uppercase text-white shrink-0">
                            {greetingName[0]}
                        </div>
                    )}
                    <div className="min-w-0">
                        <p className="text-sm font-bold text-white truncate">
                            What are you watching tonight, {greetingName}?
                        </p>
                        <p className="text-xs text-zinc-400 truncate">
                            Log an episode, rate a movie, or drop a review for your friends.
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    <button
                        type="button"
                        onClick={() => navigate('/trailers')}
                        className="px-3 py-2 rounded-xl bg-[#22222C] hover:bg-[#2C2C38] border border-white/10 text-xs font-semibold text-zinc-200 flex items-center gap-1.5 transition cursor-pointer"
                    >
                        <Play className="w-3.5 h-3.5 text-[#FF6B4A] fill-[#FF6B4A]" /> Reels
                    </button>

                    <button
                        type="button"
                        onClick={() => navigate('/reviews')}
                        className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-[#FF6B4A] to-[#FF9F43] text-white text-xs font-semibold flex items-center gap-1.5 hover:opacity-95 transition cursor-pointer"
                    >
                        <Star className="w-3.5 h-3.5 fill-white" /> Write Review
                    </button>
                </div>
            </section>

            {/* Personalized "Recommended For You" Carousel */}
            <section className="space-y-3">
                <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
                        <Wand2 className="w-4 h-4 text-[#FF6B4A]" /> Recommended For You
                    </h2>
                    <span className="text-[11px] text-zinc-400">
                        Based on your watches, likes &amp; interests
                    </span>
                </div>

                {loadingRecs ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {[0, 1, 2, 3].map((idx) => (
                            <div
                                key={idx}
                                className="h-60 rounded-2xl bg-[#18181F] border border-white/5 animate-pulse"
                            />
                        ))}
                    </div>
                ) : recommendations.length === 0 ? (
                    <div className="bg-[#18181F] border border-white/10 rounded-2xl p-4 text-xs text-zinc-400">
                        Like a few trailers or rate a movie to unlock personalized picks!
                    </div>
                ) : (
                    <div className="flex gap-3 overflow-x-auto pb-2 snap-x">
                        {recommendations.map((item) => {
                            const year = (item.release_date || '').slice(0, 4)
                            const key = `${item.media_type}-${item.id}`
                            const inWatchlist = myWatchlistKeys.has(key)
                            const busy = togglingKey === key
                            const mediaPayload: SelectedMedia = {
                                tmdb_id: item.id,
                                media_type: item.media_type,
                                title: item.title,
                                poster_path: item.poster_path,
                                overview: item.overview,
                            }

                            return (
                                <div
                                    key={key}
                                    className="w-40 sm:w-44 shrink-0 snap-start bg-[#18181F] border border-white/10 rounded-2xl overflow-hidden flex flex-col justify-between group"
                                >
                                    <div
                                        onClick={() => setPreviewMedia(mediaPayload)}
                                        className="relative cursor-pointer"
                                    >
                                        {item.poster_path ? (
                                            <img
                                                src={posterUrl(item.poster_path, 'w342')}
                                                alt={item.title}
                                                className="w-full aspect-[2/3] object-cover group-hover:scale-105 transition duration-300"
                                            />
                                        ) : (
                                            <div className="w-full aspect-[2/3] bg-[#22222C]" />
                                        )}

                                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-95" />

                                        <span className="absolute top-2 left-2 right-10 px-2 py-0.5 rounded-full bg-black/75 backdrop-blur-xs border border-white/10 text-[9px] font-semibold text-[#FF9F43] truncate">
                                            {item.reason}
                                        </span>

                                        <span className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/65 backdrop-blur-xs border border-white/15 flex items-center justify-center text-white group-hover:bg-[#FF6B4A] transition">
                                            <Play className="w-3 h-3 fill-current ml-0.5" />
                                        </span>

                                        <div className="absolute bottom-2 inset-x-2.5">
                                            <p className="text-xs font-bold text-white truncate">{item.title}</p>
                                            <p className="text-[10px] text-zinc-300">
                                                {item.media_type === 'tv' ? 'Series' : 'Movie'}
                                                {year ? ` • ${year}` : ''}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="p-2 flex items-center gap-1.5 bg-[#14141A]">
                                        <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() =>
                                                handleToggleWatchlistItem({
                                                    tmdb_id: item.id,
                                                    media_type: item.media_type,
                                                    title: item.title,
                                                    poster_path: item.poster_path,
                                                })
                                            }
                                            className={`flex-1 py-1.5 rounded-lg text-[10px] font-semibold flex items-center justify-center gap-1 transition cursor-pointer ${
                                                inWatchlist
                                                    ? 'bg-[#FF6B4A]/20 text-[#FF9F43] border border-[#FF6B4A]/40'
                                                    : 'bg-[#22222C] hover:bg-[#2C2C38] text-zinc-200'
                                            }`}
                                        >
                                            {inWatchlist ? (
                                                <>
                                                    <Bookmark className="w-2.5 h-2.5 fill-[#FF9F43]" /> Saved
                                                </>
                                            ) : (
                                                <>
                                                    <Plus className="w-2.5 h-2.5" /> Watchlist
                                                </>
                                            )}
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => onOpenMedia?.(mediaPayload)}
                                            title="Rate or log"
                                            className="px-2 py-1.5 rounded-lg bg-[#22222C] hover:bg-[#FF6B4A] text-zinc-300 hover:text-white text-[10px] font-semibold transition cursor-pointer"
                                        >
                                            Log
                                        </button>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </section>

            {/* Tonight's Trending Carousel */}
            <section className="space-y-3">
                <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
                        <Sparkles className="w-4 h-4 text-[#FF9F43]" /> Trending Tonight
                    </h2>
                    <button
                        type="button"
                        onClick={() => navigate('/search')}
                        className="text-xs font-semibold text-zinc-400 hover:text-[#FF9F43] flex items-center gap-1 transition cursor-pointer"
                    >
                        Explore all <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                </div>

                {loadingTrending ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {[0, 1, 2, 3].map((idx) => (
                            <div
                                key={idx}
                                className="h-56 rounded-2xl bg-[#18181F] border border-white/5 animate-pulse"
                            />
                        ))}
                    </div>
                ) : (
                    <div className="flex gap-3 overflow-x-auto pb-2 snap-x">
                        {trending.map((item) => {
                            const title = item.title || item.name || 'Untitled'
                            const year = (item.release_date || item.first_air_date || '').slice(0, 4)
                            const key = `${item.media_type}-${item.id}`
                            const inWatchlist = myWatchlistKeys.has(key)
                            const busy = togglingKey === key
                            const mediaPayload: SelectedMedia = {
                                tmdb_id: item.id,
                                media_type: item.media_type,
                                title,
                                poster_path: item.poster_path,
                                overview: item.overview,
                            }

                            return (
                                <div
                                    key={key}
                                    className="w-36 sm:w-40 shrink-0 snap-start bg-[#18181F] border border-white/10 rounded-2xl overflow-hidden flex flex-col justify-between group"
                                >
                                    <div
                                        onClick={() => setPreviewMedia(mediaPayload)}
                                        className="relative cursor-pointer"
                                    >
                                        {item.poster_path ? (
                                            <img
                                                src={posterUrl(item.poster_path, 'w342')}
                                                alt={title}
                                                className="w-full aspect-[2/3] object-cover group-hover:scale-105 transition duration-300"
                                            />
                                        ) : (
                                            <div className="w-full aspect-[2/3] bg-[#22222C]" />
                                        )}

                                        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-transparent opacity-90" />

                                        <span className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/65 backdrop-blur-xs border border-white/15 flex items-center justify-center text-white group-hover:bg-[#FF6B4A] transition">
                                            <Play className="w-3 h-3 fill-current ml-0.5" />
                                        </span>

                                        <div className="absolute bottom-2 inset-x-2.5">
                                            <p className="text-xs font-bold text-white truncate">{title}</p>
                                            <p className="text-[10px] text-zinc-300">
                                                {item.media_type === 'tv' ? 'Series' : 'Movie'}
                                                {year ? ` • ${year}` : ''}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="p-2 flex items-center gap-1.5 bg-[#14141A]">
                                        <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() =>
                                                handleToggleWatchlistItem({
                                                    tmdb_id: item.id,
                                                    media_type: item.media_type,
                                                    title,
                                                    poster_path: item.poster_path,
                                                })
                                            }
                                            className={`flex-1 py-1.5 rounded-lg text-[10px] font-semibold flex items-center justify-center gap-1 transition cursor-pointer ${
                                                inWatchlist
                                                    ? 'bg-[#FF6B4A]/20 text-[#FF9F43] border border-[#FF6B4A]/40'
                                                    : 'bg-[#22222C] hover:bg-[#2C2C38] text-zinc-200'
                                            }`}
                                        >
                                            {inWatchlist ? (
                                                <>
                                                    <Bookmark className="w-2.5 h-2.5 fill-[#FF9F43]" /> Saved
                                                </>
                                            ) : (
                                                <>
                                                    <Plus className="w-2.5 h-2.5" /> Watchlist
                                                </>
                                            )}
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => onOpenMedia?.(mediaPayload)}
                                            title="Rate or log"
                                            className="px-2 py-1.5 rounded-lg bg-[#22222C] hover:bg-[#FF6B4A] text-zinc-300 hover:text-white text-[10px] font-semibold transition cursor-pointer"
                                        >
                                            Log
                                        </button>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </section>

            {/* Active Genre Forums Strip */}
            <section className="space-y-2.5">
                <div className="flex items-center justify-between">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                        <MessageSquare className="w-3.5 h-3.5 text-[#FF6B4A]" /> Active Genre Forums
                    </h2>
                    <button
                        type="button"
                        onClick={() => navigate('/messages')}
                        className="text-[11px] font-semibold text-zinc-400 hover:text-white transition cursor-pointer"
                    >
                        Open Inbox
                    </button>
                </div>

                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                    {GENRE_FORUMS.map((forum) => {
                        const isJoined = joinedForumSlugs.includes(forum.slug)
                        return (
                            <button
                                key={forum.slug}
                                type="button"
                                onClick={() => {
                                    onJoinOrOpenForum?.(forum.slug)
                                    navigate('/messages')
                                }}
                                className="px-3 py-2 rounded-xl bg-[#18181F] hover:bg-[#22222C] border border-white/10 hover:border-[#FF6B4A]/50 flex items-center gap-2 shrink-0 transition cursor-pointer"
                            >
                                <span className="text-sm">{forum.emoji}</span>
                                <div className="text-left">
                                    <p className="text-xs font-bold text-white leading-tight">{forum.name}</p>
                                    <p className="text-[10px] text-zinc-400">
                                        {isJoined ? 'Joined • Tap to chat' : 'Join discussion'}
                                    </p>
                                </div>
                            </button>
                        )
                    })}
                </div>
            </section>

            {/* Activity Feed Header + Filter Pills */}
            <section className="space-y-3.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <h1 className="text-base font-bold flex items-center gap-2">
                        <Flame className="w-5 h-5 text-[#FF6B4A]" /> Activity Feed
                        <span className="text-xs font-normal text-zinc-400">
                            ({filteredLogs.length})
                        </span>
                    </h1>

                    <div className="flex items-center gap-1.5 bg-[#18181F] p-1 rounded-xl border border-white/10 w-fit">
                        {(
                            [
                                { id: 'all', label: 'All' },
                                { id: 'friends', label: 'Friends' },
                                { id: 'reviews', label: 'Reviews' },
                                { id: 'watching', label: 'Watching' },
                            ] as { id: FeedFilter; label: string }[]
                        ).map((tab) => (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setFeedFilter(tab.id)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                                    feedFilter === tab.id
                                        ? 'bg-[#FF6B4A] text-white'
                                        : 'text-zinc-400 hover:text-white'
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </div>

                {filteredLogs.length === 0 ? (
                    <div className="bg-[#18181F] border border-white/10 rounded-2xl p-8 text-center space-y-2">
                        <p className="text-sm font-medium text-zinc-200">No updates in this filter yet</p>
                        <p className="text-xs text-zinc-400">
                            Pick a trending title above or write a review to light up your feed!
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3.5">
                        {filteredLogs.map((log) => {
                            const viewerLog = myLogs.find(
                                (m) => m.tmdb_id === log.tmdb_id && m.media_type === log.media_type
                            )
                            const isShareOpen = openShareLogId === log.id
                            const key = `${log.media_type}-${log.tmdb_id}`

                            return (
                                <div key={log.id} className="relative">
                                    <FeedCard
                                        log={log}
                                        viewerLog={viewerLog}
                                        isOwnLog={log.user_id === user?.id}
                                        togglingWatchlist={togglingKey === key}
                                        onToggleWatchlist={handleToggleWatchlistItem}
                                        onWatchTrailer={setPreviewMedia}
                                        onOpenMedia={onOpenMedia}
                                    />

                                    {user && log.review_text && (
                                        <div className="mt-1.5 flex justify-end">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setSentFeedback(null)
                                                    setOpenShareLogId(isShareOpen ? null : log.id)
                                                }}
                                                className="px-2.5 py-1 rounded-lg bg-[#18181F] hover:bg-[#22222C] border border-white/10 text-[11px] font-semibold text-zinc-300 hover:text-[#FF9F43] flex items-center gap-1 transition cursor-pointer"
                                            >
                                                <Send className="w-3 h-3" /> Send Review
                                            </button>
                                        </div>
                                    )}

                                    {isShareOpen && user && (
                                        <div className="mt-1.5 ml-auto w-60 bg-[#22222C] border border-white/15 rounded-2xl p-2.5 shadow-2xl space-y-2 z-20">
                                            {sentFeedback ? (
                                                <p className="text-xs text-emerald-400 px-2 py-1.5 flex items-center gap-1.5">
                                                    <Check className="w-3.5 h-3.5" /> {sentFeedback}
                                                </p>
                                            ) : (
                                                <>
                                                    {joinedForums.length > 0 && (
                                                        <div className="space-y-1">
                                                            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 px-2 flex items-center gap-1">
                                                                <Hash className="w-3 h-3 text-[#FF9F43]" /> Forums
                                                            </p>
                                                            {joinedForums.map((forum) => (
                                                                <button
                                                                    key={forum.slug}
                                                                    type="button"
                                                                    onClick={async () => {
                                                                        await shareReviewToForum(user.id, forum.slug, log)
                                                                        notifySent(`Sent to ${forum.name}`)
                                                                    }}
                                                                    className="w-full text-left px-2.5 py-1.5 rounded-xl text-xs text-zinc-200 hover:bg-[#FF6B4A] hover:text-white transition cursor-pointer"
                                                                >
                                                                    {forum.emoji} {forum.name}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {friends.length > 0 && (
                                                        <div className="space-y-1 border-t border-white/10 pt-1.5">
                                                            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 px-2 flex items-center gap-1">
                                                                <Users className="w-3 h-3 text-[#FF6B4A]" /> Friends
                                                            </p>
                                                            {friends.map((friend) => (
                                                                <button
                                                                    key={friend.id}
                                                                    type="button"
                                                                    onClick={async () => {
                                                                        await shareReviewToFriend(user.id, friend.id, log)
                                                                        notifySent(`Sent to @${friend.username}`)
                                                                    }}
                                                                    className="w-full text-left px-2.5 py-1.5 rounded-xl text-xs text-zinc-200 hover:bg-[#FF6B4A] hover:text-white transition cursor-pointer"
                                                                >
                                                                    @{friend.username}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {joinedForums.length === 0 && friends.length === 0 && (
                                                        <p className="text-[11px] text-zinc-400 px-2 py-1">
                                                            Join a forum or follow friends to share reviews.
                                                        </p>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}
            </section>

            <TrailerPreviewModal
                media={previewMedia}
                onClose={() => setPreviewMedia(null)}
                onOpenLogModal={(media) => {
                    setPreviewMedia(null)
                    onOpenMedia?.(media)
                }}
            />
        </div>
    )
}