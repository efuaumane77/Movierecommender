import { useEffect, useRef, useState } from 'react'
import {
    Search,
    Film,
    Users,
    MessageSquareText,
    Star,
    UserPlus,
    Check,
    Clock,
    Plus,
    X,
    Flame,
} from 'lucide-react'
import { getTrending, searchMulti, posterUrl, type TMDBSearchResult } from '../lib/tmdb'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { MediaLog, Profile, TrailerComment } from '../types/database'
import type { SelectedMedia } from '../components/media/MediaModal'
import { TrailerPreviewModal } from '../components/media/TrailerPreviewModal'

type SearchTab = 'all' | 'media' | 'users' | 'reviews'

interface ReviewSearchHit {
    id: string
    source: 'log' | 'trailer'
    user_id: string
    username: string
    tmdb_id: number
    media_type: 'movie' | 'tv'
    title: string
    poster_path: string | null
    rating: number | null
    text: string
    created_at: string
}

interface SearchPageProps {
    initialQuery?: string
    friendIds: Set<string>
    outgoingRequestIds: Set<string>
    onFollowUser: (targetUserId: string) => Promise<void>
    onOpenMedia: (media: SelectedMedia) => void
}

export function SearchPage({
                               initialQuery = '',
                               friendIds,
                               outgoingRequestIds,
                               onFollowUser,
                               onOpenMedia,
                           }: SearchPageProps) {
    const { user } = useAuth()
    const inputRef = useRef<HTMLInputElement | null>(null)
    const [query, setQuery] = useState(initialQuery)
    const [activeTab, setActiveTab] = useState<SearchTab>('all')
    const [loading, setLoading] = useState(false)
    const [loadingExplore, setLoadingExplore] = useState(true)
    const [previewMedia, setPreviewMedia] = useState<SelectedMedia | null>(null)

    // Live search results
    const [mediaResults, setMediaResults] = useState<TMDBSearchResult[]>([])
    const [userResults, setUserResults] = useState<Profile[]>([])
    const [reviewResults, setReviewResults] = useState<ReviewSearchHit[]>([])

    // Default Explore / Trending state when search bar is empty
    const [trendingMedia, setTrendingMedia] = useState<TMDBSearchResult[]>([])
    const [discoverUsers, setDiscoverUsers] = useState<Profile[]>([])
    const [recentReviews, setRecentReviews] = useState<ReviewSearchHit[]>([])

    useEffect(() => {
        inputRef.current?.focus()
    }, [])

    useEffect(() => {
        if (initialQuery) setQuery(initialQuery)
    }, [initialQuery])

    // Load Trending Media, Users, and Recent Reviews on mount
    useEffect(() => {
        let cancelled = false
        setLoadingExplore(true)

        Promise.all([
            getTrending(),
            supabase
                .from('profiles')
                .select('*')
                .neq('id', user?.id ?? '')
                .order('created_at', { ascending: false })
                .limit(8),
            supabase
                .from('media_logs')
                .select('*, profiles(id, username, avatar_url, created_at)')
                .not('review_text', 'is', null)
                .neq('review_text', '')
                .order('updated_at', { ascending: false })
                .limit(8),
            supabase
                .from('trailer_comments')
                .select('*, profiles(id, username, avatar_url, created_at)')
                .order('created_at', { ascending: false })
                .limit(8),
        ])
            .then(([trendingHits, { data: usersData }, { data: logsData }, { data: commentsData }]) => {
                if (cancelled) return

                const topTrending = trendingHits.slice(0, 8)
                setTrendingMedia(topTrending)
                setDiscoverUsers((usersData as Profile[]) ?? [])

                const titleByTmdb = new Map<string, { title: string; poster_path: string | null }>()
                for (const m of topTrending) {
                    titleByTmdb.set(`${m.media_type}-${m.id}`, {
                        title: m.title || m.name || 'Untitled',
                        poster_path: m.poster_path,
                    })
                }

                const merged: ReviewSearchHit[] = []

                if (logsData) {
                    for (const log of logsData as MediaLog[]) {
                        if (!log.review_text?.trim()) continue
                        merged.push({
                            id: `log-${log.id}`,
                            source: 'log',
                            user_id: log.user_id,
                            username: log.profiles?.username ?? 'user',
                            tmdb_id: log.tmdb_id,
                            media_type: log.media_type,
                            title: log.title,
                            poster_path: log.poster_path,
                            rating: log.rating,
                            text: log.review_text,
                            created_at: log.updated_at,
                        })
                    }
                }

                if (commentsData) {
                    for (const comment of commentsData as TrailerComment[]) {
                        const meta = titleByTmdb.get(`${comment.media_type}-${comment.tmdb_id}`)
                        merged.push({
                            id: `trailer-${comment.id}`,
                            source: 'trailer',
                            user_id: comment.user_id,
                            username: comment.profiles?.username ?? 'user',
                            tmdb_id: comment.tmdb_id,
                            media_type: comment.media_type,
                            title:
                                meta?.title ?? `${comment.media_type === 'tv' ? 'TV' : 'Movie'} #${comment.tmdb_id}`,
                            poster_path: meta?.poster_path ?? null,
                            rating: comment.rating,
                            text: comment.comment_text,
                            created_at: comment.created_at,
                        })
                    }
                }

                merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                setRecentReviews(merged.slice(0, 8))
            })
            .catch(console.error)
            .finally(() => {
                if (!cancelled) setLoadingExplore(false)
            })

        return () => {
            cancelled = true
        }
    }, [user?.id])

    // Live debounced search when query has text
    useEffect(() => {
        const trimmed = query.trim()
        if (!trimmed) {
            setMediaResults([])
            setUserResults([])
            setReviewResults([])
            setLoading(false)
            return
        }

        let cancelled = false
        const timer = setTimeout(async () => {
            setLoading(true)
            const cleanHandle = trimmed.replace(/^@/, '')

            try {
                const [
                    tmdbHits,
                    { data: matchedUsers },
                    { data: matchedMediaLogs },
                    { data: matchedTrailerComments },
                ] = await Promise.all([
                    searchMulti(trimmed),
                    supabase
                        .from('profiles')
                        .select('*')
                        .ilike('username', `%${cleanHandle}%`)
                        .neq('id', user?.id ?? '')
                        .limit(12),
                    supabase
                        .from('media_logs')
                        .select('*, profiles(id, username, avatar_url, created_at)')
                        .not('review_text', 'is', null)
                        .or(`review_text.ilike.%${trimmed}%,title.ilike.%${trimmed}%`)
                        .order('updated_at', { ascending: false })
                        .limit(15),
                    supabase
                        .from('trailer_comments')
                        .select('*, profiles(id, username, avatar_url, created_at)')
                        .ilike('comment_text', `%${trimmed}%`)
                        .order('created_at', { ascending: false })
                        .limit(15),
                ])

                if (cancelled) return

                const topMedia = tmdbHits.slice(0, 12)
                setMediaResults(topMedia)
                setUserResults((matchedUsers as Profile[]) ?? [])

                const titleByTmdb = new Map<string, { title: string; poster_path: string | null }>()
                for (const m of topMedia) {
                    titleByTmdb.set(`${m.media_type}-${m.id}`, {
                        title: m.title || m.name || 'Untitled',
                        poster_path: m.poster_path,
                    })
                }

                const combinedReviews: ReviewSearchHit[] = []

                if (matchedMediaLogs) {
                    for (const log of matchedMediaLogs as MediaLog[]) {
                        if (!log.review_text?.trim()) continue
                        combinedReviews.push({
                            id: `log-${log.id}`,
                            source: 'log',
                            user_id: log.user_id,
                            username: log.profiles?.username ?? 'user',
                            tmdb_id: log.tmdb_id,
                            media_type: log.media_type,
                            title: log.title,
                            poster_path: log.poster_path,
                            rating: log.rating,
                            text: log.review_text,
                            created_at: log.updated_at,
                        })
                    }
                }

                if (matchedTrailerComments) {
                    for (const comment of matchedTrailerComments as TrailerComment[]) {
                        const meta = titleByTmdb.get(`${comment.media_type}-${comment.tmdb_id}`)
                        combinedReviews.push({
                            id: `trailer-${comment.id}`,
                            source: 'trailer',
                            user_id: comment.user_id,
                            username: comment.profiles?.username ?? 'user',
                            tmdb_id: comment.tmdb_id,
                            media_type: comment.media_type,
                            title:
                                meta?.title ?? `${comment.media_type === 'tv' ? 'TV' : 'Movie'} #${comment.tmdb_id}`,
                            poster_path: meta?.poster_path ?? null,
                            rating: comment.rating,
                            text: comment.comment_text,
                            created_at: comment.created_at,
                        })
                    }
                }

                setReviewResults(combinedReviews)
            } catch (err) {
                console.error(err)
            } finally {
                if (!cancelled) setLoading(false)
            }
        }, 300)

        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [query, user?.id])

    const isSearching = query.trim().length > 0
    const displayedMedia = isSearching ? mediaResults : trendingMedia
    const displayedUsers = isSearching ? userResults : discoverUsers
    const displayedReviews = isSearching ? reviewResults : recentReviews

    const tabs: { key: SearchTab; label: string; count: number }[] = [
        {
            key: 'all',
            label: 'All',
            count: displayedMedia.length + displayedUsers.length + displayedReviews.length,
        },
        { key: 'media', label: 'Media', count: displayedMedia.length },
        { key: 'users', label: 'Users', count: displayedUsers.length },
        { key: 'reviews', label: 'Reviews', count: displayedReviews.length },
    ]

    const showMedia = activeTab === 'all' || activeTab === 'media'
    const showUsers = activeTab === 'all' || activeTab === 'users'
    const showReviews = activeTab === 'all' || activeTab === 'reviews'

    return (
        <div className="space-y-5">
            <div>
                <h1 className="text-lg font-bold flex items-center gap-2">
                    <Search className="w-5 h-5 text-[#FF6B4A]" /> Explore & Search
                </h1>
                <p className="text-xs text-zinc-400 mt-0.5">
                    Search movies, TV shows, @usernames, and friend reviews
                </p>
            </div>

            {/* Search Input */}
            <div className="relative">
                <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search titles, @users, or review keywords..."
                    className="w-full bg-[#18181F] border border-white/15 focus:border-[#FF6B4A] rounded-2xl pl-10 pr-10 py-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none transition"
                />
                {query && (
                    <button
                        type="button"
                        onClick={() => setQuery('')}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white cursor-pointer"
                    >
                        <X className="w-4 h-4" />
                    </button>
                )}
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {tabs.map((tab) => {
                    const active = activeTab === tab.key
                    return (
                        <button
                            key={tab.key}
                            type="button"
                            onClick={() => setActiveTab(tab.key)}
                            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shrink-0 ${
                                active
                                    ? 'bg-gradient-to-r from-[#FF6B4A] to-[#FF9F43] text-white'
                                    : 'bg-[#18181F] border border-white/10 text-zinc-300 hover:text-white'
                            }`}
                        >
                            <span>{tab.label}</span>
                            <span
                                className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                                    active ? 'bg-black/25 text-white' : 'bg-white/10 text-zinc-400'
                                }`}
                            >
                {tab.count}
              </span>
                        </button>
                    )
                })}
            </div>

            {isSearching && loading ? (
                <p className="text-xs text-zinc-400 py-4">Searching media, users, and reviews...</p>
            ) : !isSearching && loadingExplore ? (
                <p className="text-xs text-zinc-400 py-4">Loading trending movies, people, and reviews...</p>
            ) : (
                <div className="space-y-6">
                    {/* Trending / Matched Media Section */}
                    {showMedia && (
                        <section className="space-y-2.5">
                            <div className="flex items-center justify-between">
                                <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                                    {isSearching ? (
                                        <>
                                            <Film className="w-3.5 h-3.5 text-[#FF6B4A]" /> Movies & TV ({displayedMedia.length})
                                        </>
                                    ) : (
                                        <>
                                            <Flame className="w-3.5 h-3.5 text-[#FF6B4A]" /> Trending Movies & TV
                                        </>
                                    )}
                                </h2>
                                {!isSearching && displayedMedia.length > 0 && (
                                    <span className="text-[11px] text-zinc-500">Click any card to watch trailer</span>
                                )}
                            </div>

                            {displayedMedia.length === 0 ? (
                                <p className="text-xs text-zinc-500 bg-[#18181F] border border-white/5 rounded-xl p-3">
                                    No movies or TV shows found matching "{query}".
                                </p>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                    {(activeTab === 'all' ? displayedMedia.slice(0, 6) : displayedMedia).map((item) => {
                                        const title = item.title || item.name || 'Untitled'
                                        const year = (item.release_date || item.first_air_date || '').slice(0, 4)
                                        const payload: SelectedMedia = {
                                            tmdb_id: item.id,
                                            media_type: item.media_type,
                                            title,
                                            poster_path: item.poster_path,
                                            overview: item.overview,
                                        }

                                        return (
                                            <div
                                                key={`${item.media_type}-${item.id}`}
                                                onClick={() => setPreviewMedia(payload)}
                                                className="bg-[#18181F] hover:bg-[#1E1E27] border border-white/10 hover:border-[#FF6B4A]/50 rounded-2xl p-2.5 flex items-center gap-3 transition cursor-pointer"
                                            >
                                                {item.poster_path ? (
                                                    <img
                                                        src={posterUrl(item.poster_path, 'w185')}
                                                        alt={title}
                                                        className="w-11 h-16 rounded-xl object-cover shrink-0"
                                                    />
                                                ) : (
                                                    <div className="w-11 h-16 rounded-xl bg-[#22222C] shrink-0" />
                                                )}

                                                <div className="min-w-0 flex-1">
                                                    <p className="text-xs font-bold text-white truncate">{title}</p>
                                                    <p className="text-[11px] text-zinc-400 mt-0.5">
                                                        {item.media_type === 'tv' ? 'TV Series' : 'Movie'}
                                                        {year ? ` • ${year}` : ''}
                                                        {item.vote_average ? ` • ★ ${item.vote_average.toFixed(1)}` : ''}
                                                    </p>
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            onOpenMedia(payload)
                                                        }}
                                                        className="mt-2 px-2.5 py-1 rounded-lg bg-[#22222C] hover:bg-[#FF6B4A] text-zinc-200 hover:text-white text-[11px] font-semibold inline-flex items-center gap-1 transition cursor-pointer"
                                                    >
                                                        <Plus className="w-3 h-3" /> Log / Review
                                                    </button>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </section>
                    )}

                    {/* People / Users Section */}
                    {showUsers && (
                        <section className="space-y-2.5">
                            <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                                <Users className="w-3.5 h-3.5 text-[#FF9F43]" />{' '}
                                {isSearching
                                    ? `Users (${displayedUsers.length})`
                                    : `People on Cinerate (${displayedUsers.length})`}
                            </h2>

                            {displayedUsers.length === 0 ? (
                                <p className="text-xs text-zinc-500 bg-[#18181F] border border-white/5 rounded-xl p-3">
                                    {isSearching
                                        ? `No users found matching "${query}".`
                                        : 'No other users on Cinerate yet — invite your friends!'}
                                </p>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                    {displayedUsers.map((person) => {
                                        const isFollowing = friendIds.has(person.id)
                                        const isRequested = outgoingRequestIds.has(person.id)

                                        return (
                                            <div
                                                key={person.id}
                                                className="bg-[#18181F] border border-white/10 rounded-2xl p-3 flex items-center justify-between gap-2.5"
                                            >
                                                <div className="flex items-center gap-2.5 min-w-0">
                                                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#FF6B4A]/30 to-[#FF9F43]/30 border border-white/15 flex items-center justify-center font-bold text-xs uppercase text-[#FF9F43] shrink-0">
                                                        {person.username[0]}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="text-xs font-bold text-white truncate">
                                                            @{person.username}
                                                        </p>
                                                        <p className="text-[11px] text-zinc-500">Cinerate Member</p>
                                                    </div>
                                                </div>

                                                {isFollowing ? (
                                                    <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-400 text-[11px] font-semibold flex items-center gap-1 shrink-0">
                            <Check className="w-3 h-3" /> Following
                          </span>
                                                ) : isRequested ? (
                                                    <span className="px-2.5 py-1 rounded-lg bg-[#22222C] text-zinc-400 text-[11px] font-semibold flex items-center gap-1 shrink-0">
                            <Clock className="w-3 h-3" /> Requested
                          </span>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => onFollowUser(person.id)}
                                                        className="px-3 py-1.5 rounded-lg bg-[#FF6B4A] hover:bg-[#FF9F43] text-white text-xs font-semibold flex items-center gap-1 transition cursor-pointer shrink-0"
                                                    >
                                                        <UserPlus className="w-3 h-3" /> Follow
                                                    </button>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </section>
                    )}

                    {/* Recent / Matched Reviews Section */}
                    {showReviews && (
                        <section className="space-y-2.5">
                            <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                                <MessageSquareText className="w-3.5 h-3.5 text-[#FF9F43]" />{' '}
                                {isSearching
                                    ? `Reviews (${displayedReviews.length})`
                                    : `Latest Reviews (${displayedReviews.length})`}
                            </h2>

                            {displayedReviews.length === 0 ? (
                                <p className="text-xs text-zinc-500 bg-[#18181F] border border-white/5 rounded-xl p-3">
                                    {isSearching
                                        ? `No user or trailer reviews found matching "${query}".`
                                        : 'No reviews posted yet — rate a trailer or log a movie to be first!'}
                                </p>
                            ) : (
                                <div className="space-y-2.5">
                                    {displayedReviews.map((rev) => (
                                        <div
                                            key={rev.id}
                                            onClick={() =>
                                                setPreviewMedia({
                                                    tmdb_id: rev.tmdb_id,
                                                    media_type: rev.media_type,
                                                    title: rev.title,
                                                    poster_path: rev.poster_path,
                                                })
                                            }
                                            className="bg-[#18181F] hover:bg-[#1E1E27] border border-white/10 rounded-2xl p-3.5 flex items-start gap-3 transition cursor-pointer"
                                        >
                                            {rev.poster_path ? (
                                                <img
                                                    src={posterUrl(rev.poster_path, 'w185')}
                                                    alt={rev.title}
                                                    className="w-10 h-14 rounded-lg object-cover shrink-0"
                                                />
                                            ) : (
                                                <div className="w-10 h-14 rounded-lg bg-[#22222C] shrink-0" />
                                            )}

                                            <div className="min-w-0 flex-1 space-y-1">
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs font-bold text-white truncate">
                              @{rev.username}
                            </span>
                                                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-zinc-400 shrink-0">
                              {rev.source === 'trailer' ? 'Trailer Review' : 'Media Review'}
                            </span>
                                                    </div>

                                                    {rev.rating !== null && (
                                                        <span className="text-xs font-bold text-[#FF9F43] flex items-center gap-0.5 shrink-0">
                              <Star className="w-3.5 h-3.5 fill-[#FF9F43]" /> {rev.rating}/5
                            </span>
                                                    )}
                                                </div>

                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        onOpenMedia({
                                                            tmdb_id: rev.tmdb_id,
                                                            media_type: rev.media_type,
                                                            title: rev.title,
                                                            poster_path: rev.poster_path,
                                                        })
                                                    }}
                                                    className="text-xs font-semibold text-[#FF6B4A] hover:underline text-left cursor-pointer"
                                                >
                                                    {rev.title}
                                                </button>

                                                <p className="text-xs text-zinc-300 leading-relaxed">{rev.text}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    )}
                </div>
            )}

            <TrailerPreviewModal
                media={previewMedia}
                onClose={() => setPreviewMedia(null)}
                onOpenLogModal={onOpenMedia}
            />
        </div>
    )
}