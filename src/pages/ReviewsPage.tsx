import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    Star,
    Search,
    Sparkles,
    Check,
    Send,
    Edit3,
    Film,
    Tv,
    X,
    Hash,
    Users,
    MessageSquareText,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import {
    getTrending,
    posterUrl,
    searchMulti,
    type TMDBSearchResult,
} from '../lib/tmdb'
import { GENRE_FORUMS } from '../lib/forums'
import type { MediaLog, MediaStatus, Profile } from '../types/database'
import type { SelectedMedia } from '../components/media/MediaModal'

interface ReviewsPageProps {
    feedLogs: MediaLog[]
    myLogs: MediaLog[]
    friends: Profile[]
    joinedForumSlugs: string[]
    onOpenMedia: (media: SelectedMedia) => void
    onLogsUpdated: () => void
}

type ReviewFilter = 'all' | 'friends' | 'mine'

const RATING_STEPS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]

export function ReviewsPage({
                                feedLogs,
                                myLogs,
                                friends,
                                joinedForumSlugs,
                                onOpenMedia,
                                onLogsUpdated,
                            }: ReviewsPageProps) {
    const { user, profile } = useAuth()
    const navigate = useNavigate()

    // Inline composer state
    const [searchQuery, setSearchQuery] = useState('')
    const [searchHits, setSearchHits] = useState<TMDBSearchResult[]>([])
    const [searching, setSearching] = useState(false)
    const [trendingPicks, setTrendingPicks] = useState<TMDBSearchResult[]>([])

    const [draftTarget, setDraftTarget] = useState<{
        tmdb_id: number
        media_type: 'movie' | 'tv'
        title: string
        poster_path: string | null
        year?: string
    } | null>(null)
    const [status, setStatus] = useState<MediaStatus>('watched')
    const [rating, setRating] = useState<number>(4.5)
    const [reviewText, setReviewText] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [composerError, setComposerError] = useState<string | null>(null)
    const [justPublishedTitle, setJustPublishedTitle] = useState<string | null>(null)

    // Feed filter & search state
    const [filter, setFilter] = useState<ReviewFilter>('all')
    const [reviewSearch, setReviewSearch] = useState('')
    const [openShareLogId, setOpenShareLogId] = useState<string | null>(null)
    const [sentFeedback, setSentFeedback] = useState<string | null>(null)

    // Load trending quick-picks for the composer
    useEffect(() => {
        let cancelled = false
        getTrending(1)
            .then((items) => {
                if (!cancelled) setTrendingPicks(items.slice(0, 6))
            })
            .catch(console.error)
        return () => {
            cancelled = true
        }
    }, [])

    // Debounced TMDB search inside the Review Studio
    useEffect(() => {
        const trimmed = searchQuery.trim()
        if (!trimmed) return

        let cancelled = false
        const timer = setTimeout(async () => {
            setSearching(true)
            try {
                const results = await searchMulti(trimmed)
                if (!cancelled) setSearchHits(results.slice(0, 6))
            } catch (err) {
                console.error(err)
            } finally {
                if (!cancelled) setSearching(false)
            }
        }, 260)

        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [searchQuery])

    function selectTitleForReview(item: {
        tmdb_id: number
        media_type: 'movie' | 'tv'
        title: string
        poster_path: string | null
        year?: string
    }) {
        setComposerError(null)
        setJustPublishedTitle(null)
        setDraftTarget(item)
        setSearchQuery('')
        setSearchHits([])
        setSearching(false)

        const existing = myLogs.find(
            (l) => l.tmdb_id === item.tmdb_id && l.media_type === item.media_type
        )
        if (existing) {
            setStatus(existing.status)
            setRating(existing.rating ?? 4.5)
            setReviewText(existing.review_text ?? '')
        } else {
            setStatus('watched')
            setRating(4.5)
            setReviewText('')
        }
    }

    async function handlePublishReview(e: React.FormEvent) {
        e.preventDefault()
        if (!user || !draftTarget) return
        if (!reviewText.trim()) {
            setComposerError('Write a few thoughts before publishing your review.')
            return
        }

        setComposerError(null)
        setSubmitting(true)

        const existing = myLogs.find(
            (l) =>
                l.tmdb_id === draftTarget.tmdb_id &&
                l.media_type === draftTarget.media_type
        )

        const { error } = await supabase.from('media_logs').upsert(
            {
                user_id: user.id,
                tmdb_id: draftTarget.tmdb_id,
                media_type: draftTarget.media_type,
                title: draftTarget.title,
                poster_path: draftTarget.poster_path,
                status,
                rating,
                review_text: reviewText.trim(),
                season: existing?.season ?? 1,
                episode: existing?.episode ?? 0,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,tmdb_id,media_type' }
        )

        setSubmitting(false)

        if (error) {
            setComposerError(error.message)
            return
        }

        const publishedName = draftTarget.title
        setDraftTarget(null)
        setReviewText('')
        setJustPublishedTitle(publishedName)
        onLogsUpdated()
        setTimeout(() => setJustPublishedTitle(null), 3000)
    }

    const friendIds = useMemo(() => new Set(friends.map((f) => f.id)), [friends])
    const joinedForums = useMemo(
        () => GENRE_FORUMS.filter((f) => joinedForumSlugs.includes(f.slug)),
        [joinedForumSlugs]
    )

    const allWrittenReviews = useMemo(() => {
        const merged = new Map<string, MediaLog>()
        for (const log of feedLogs) {
            if (log.review_text && log.review_text.trim().length > 0) {
                merged.set(log.id, log)
            }
        }
        for (const log of myLogs) {
            if (log.review_text && log.review_text.trim().length > 0) {
                merged.set(log.id, {
                    ...log,
                    profiles: log.profiles ?? profile ?? undefined,
                })
            }
        }
        return Array.from(merged.values()).sort(
            (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        )
    }, [feedLogs, myLogs, profile])

    const visibleReviews = useMemo(() => {
        return allWrittenReviews.filter((rev) => {
            if (filter === 'mine' && rev.user_id !== user?.id) return false
            if (filter === 'friends' && !friendIds.has(rev.user_id)) return false

            if (reviewSearch.trim()) {
                const q = reviewSearch.toLowerCase()
                const matchesTitle = rev.title.toLowerCase().includes(q)
                const matchesUser = (rev.profiles?.username ?? '').toLowerCase().includes(q)
                const matchesBody = (rev.review_text ?? '').toLowerCase().includes(q)
                return matchesTitle || matchesUser || matchesBody
            }
            return true
        })
    }, [allWrittenReviews, filter, user?.id, friendIds, reviewSearch])

    async function handleShareReview(
        target: { type: 'dm'; id: string; label: string } | { type: 'forum'; slug: string; label: string },
        log: MediaLog
    ) {
        if (!user) return
        const payload = JSON.stringify({
            author: log.profiles?.username ?? 'user',
            rating: log.rating,
            snippet: log.review_text ?? '',
            note: '',
        })

        if (target.type === 'dm') {
            await supabase.from('messages').insert({
                sender_id: user.id,
                receiver_id: target.id,
                content: `__REVIEW__::${payload}`,
                attached_tmdb_id: log.tmdb_id,
                attached_media_type: log.media_type,
                attached_title: log.title,
                attached_poster: log.poster_path,
            })
        } else {
            await supabase.from('forum_messages').insert({
                forum_slug: target.slug,
                sender_id: user.id,
                content: `__REVIEW__::${payload}`,
                attached_tmdb_id: log.tmdb_id,
                attached_media_type: log.media_type,
                attached_title: log.title,
                attached_poster: log.poster_path,
            })
        }

        setSentFeedback(`Sent to ${target.label}`)
        setTimeout(() => {
            setSentFeedback(null)
            setOpenShareLogId(null)
        }, 1200)
    }

    return (
        <div className="space-y-6">
            {/* Page Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-lg font-bold text-white flex items-center gap-2">
                        <Star className="w-5 h-5 text-[#FF9F43] fill-[#FF9F43]" /> Reviews & Ratings
                    </h1>
                    <p className="text-xs text-zinc-400 mt-0.5">
                        Write a review for any movie or series, or read what friends are saying.
                    </p>
                </div>
            </div>

            {/* Dedicated Inline Review Composer Card */}
            <section className="bg-[#18181F] border border-white/10 rounded-2xl p-4 sm:p-5 space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-[#FF6B4A]" /> Write a Review
                    </h2>
                    {justPublishedTitle && (
                        <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1">
              <Check className="w-3.5 h-3.5" /> Published review for {justPublishedTitle}!
            </span>
                    )}
                </div>

                {!draftTarget ? (
                    <div className="space-y-3.5">
                        {/* Local TMDB Search Input */}
                        <div className="space-y-2">
                            <div className="relative">
                                <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => {
                                        const val = e.target.value
                                        setSearchQuery(val)
                                        if (!val.trim()) {
                                            setSearchHits([])
                                            setSearching(false)
                                        }
                                    }}
                                    placeholder="Search a movie or TV show to review..."
                                    className="w-full bg-[#22222C] border border-white/10 focus:border-[#FF6B4A] rounded-xl pl-10 pr-9 py-2.5 text-xs sm:text-sm text-white placeholder:text-zinc-500 focus:outline-none transition"
                                />
                                {searchQuery && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSearchQuery('')
                                            setSearchHits([])
                                            setSearching(false)
                                        }}
                                        aria-label="Clear search"
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white cursor-pointer p-0.5"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                )}
                            </div>

                            {searchQuery.trim() && (searching || searchHits.length > 0) && (
                                <div className="bg-[#14141A] border border-white/15 rounded-2xl overflow-hidden divide-y divide-white/5">
                                    {searching ? (
                                        <p className="p-3.5 text-xs text-zinc-400">Searching TMDB...</p>
                                    ) : (
                                        searchHits.map((hit) => {
                                            const title = hit.title || hit.name || 'Untitled'
                                            const year = (hit.release_date || hit.first_air_date || '').slice(0, 4)
                                            return (
                                                <button
                                                    key={`${hit.media_type}-${hit.id}`}
                                                    type="button"
                                                    onClick={() =>
                                                        selectTitleForReview({
                                                            tmdb_id: hit.id,
                                                            media_type: hit.media_type,
                                                            title,
                                                            poster_path: hit.poster_path,
                                                            year,
                                                        })
                                                    }
                                                    className="w-full flex items-center gap-3 p-2.5 hover:bg-[#22222C] transition text-left cursor-pointer"
                                                >
                                                    {hit.poster_path ? (
                                                        <img
                                                            src={posterUrl(hit.poster_path, 'w185')}
                                                            alt={title}
                                                            className="w-9 h-12 rounded-lg object-cover shrink-0"
                                                        />
                                                    ) : (
                                                        <div className="w-9 h-12 rounded-lg bg-[#22222C] shrink-0" />
                                                    )}
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-xs font-bold text-white truncate">{title}</p>
                                                        <p className="text-[11px] text-zinc-400">
                                                            {hit.media_type === 'tv' ? 'TV Series' : 'Movie'}
                                                            {year ? ` • ${year}` : ''}
                                                        </p>
                                                    </div>
                                                    <span className="text-[11px] font-semibold text-[#FF9F43] px-2.5 py-1 rounded-lg bg-[#FF6B4A]/15 shrink-0">
                            Select
                          </span>
                                                </button>
                                            )
                                        })
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Quick Pick Strip: Recent Logs or Trending Titles */}
                        {!searchQuery && (
                            <div className="space-y-2">
                                <p className="text-[11px] font-semibold text-zinc-400">
                                    {myLogs.length > 0 ? 'Quick pick from your library' : 'Trending to review'}
                                </p>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                    {(myLogs.length > 0
                                            ? myLogs.slice(0, 6).map((l) => ({
                                                tmdb_id: l.tmdb_id,
                                                media_type: l.media_type,
                                                title: l.title,
                                                poster_path: l.poster_path,
                                            }))
                                            : trendingPicks.map((t) => ({
                                                tmdb_id: t.id,
                                                media_type: t.media_type,
                                                title: t.title || t.name || 'Untitled',
                                                poster_path: t.poster_path,
                                            }))
                                    ).map((pick) => (
                                        <button
                                            key={`${pick.media_type}-${pick.tmdb_id}`}
                                            type="button"
                                            onClick={() => selectTitleForReview(pick)}
                                            className="flex items-center gap-2.5 p-2 rounded-xl bg-[#14141A] hover:bg-[#22222C] border border-white/5 hover:border-[#FF6B4A]/40 transition text-left cursor-pointer"
                                        >
                                            {pick.poster_path ? (
                                                <img
                                                    src={posterUrl(pick.poster_path, 'w185')}
                                                    alt={pick.title}
                                                    className="w-8 h-11 rounded-lg object-cover shrink-0"
                                                />
                                            ) : (
                                                <div className="w-8 h-11 rounded-lg bg-[#22222C] shrink-0" />
                                            )}
                                            <div className="min-w-0 flex-1">
                                                <p className="text-xs font-semibold text-white truncate">{pick.title}</p>
                                                <p className="text-[10px] text-zinc-400 flex items-center gap-1 mt-0.5">
                                                    {pick.media_type === 'tv' ? (
                                                        <Tv className="w-2.5 h-2.5" />
                                                    ) : (
                                                        <Film className="w-2.5 h-2.5" />
                                                    )}
                                                    <span>{pick.media_type === 'tv' ? 'Series' : 'Movie'}</span>
                                                </p>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    /* Active Review Editor Form */
                    <form onSubmit={handlePublishReview} className="space-y-4">
                        <div className="flex items-center justify-between gap-3 bg-[#14141A] border border-white/10 rounded-xl p-3">
                            <div className="flex items-center gap-3 min-w-0">
                                {draftTarget.poster_path ? (
                                    <img
                                        src={posterUrl(draftTarget.poster_path, 'w185')}
                                        alt={draftTarget.title}
                                        className="w-11 h-16 rounded-lg object-cover shrink-0"
                                    />
                                ) : (
                                    <div className="w-11 h-16 rounded-lg bg-[#22222C] shrink-0" />
                                )}
                                <div className="min-w-0">
                                    <p className="text-sm font-bold text-white truncate">{draftTarget.title}</p>
                                    <p className="text-[11px] text-zinc-400">
                                        {draftTarget.media_type === 'tv' ? 'TV Series' : 'Movie'}
                                        {draftTarget.year ? ` • ${draftTarget.year}` : ''}
                                    </p>
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={() => setDraftTarget(null)}
                                className="px-2.5 py-1 rounded-lg bg-[#22222C] text-[11px] font-semibold text-zinc-300 hover:text-white cursor-pointer shrink-0"
                            >
                                Change Title
                            </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {/* Rating Picker */}
                            <div>
                                <label className="block text-[11px] font-semibold text-zinc-400 mb-1.5">
                                    Your Rating ({rating} / 5)
                                </label>
                                <div className="flex flex-wrap gap-1">
                                    {RATING_STEPS.map((val) => (
                                        <button
                                            key={val}
                                            type="button"
                                            onClick={() => setRating(val)}
                                            className={`px-2 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${
                                                rating === val
                                                    ? 'bg-gradient-to-r from-[#FF6B4A] to-[#FF9F43] text-white'
                                                    : 'bg-[#22222C] text-zinc-400 hover:text-white'
                                            }`}
                                        >
                                            {val}★
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Status Picker */}
                            <div>
                                <label className="block text-[11px] font-semibold text-zinc-400 mb-1.5">
                                    Shelf Status
                                </label>
                                <div className="grid grid-cols-3 gap-1.5">
                                    {(['watched', 'watching', 'watchlist'] as MediaStatus[]).map((s) => (
                                        <button
                                            key={s}
                                            type="button"
                                            onClick={() => setStatus(s)}
                                            className={`py-1.5 px-2 rounded-lg text-[11px] font-semibold capitalize transition cursor-pointer ${
                                                status === s
                                                    ? 'bg-[#FF6B4A]/20 border border-[#FF6B4A] text-white'
                                                    : 'bg-[#22222C] border border-white/10 text-zinc-400 hover:text-white'
                                            }`}
                                        >
                                            {s}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div>
                            <label className="block text-[11px] font-semibold text-zinc-400 mb-1.5">
                                Review
                            </label>
                            <textarea
                                rows={3}
                                value={reviewText}
                                onChange={(e) => setReviewText(e.target.value)}
                                placeholder={`What did you think of ${draftTarget.title}?`}
                                className="w-full bg-[#22222C] border border-white/10 focus:border-[#FF6B4A] rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-white placeholder:text-zinc-500 focus:outline-none resize-none"
                            />
                        </div>

                        {composerError && <p className="text-xs text-red-400">{composerError}</p>}

                        <div className="flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setDraftTarget(null)}
                                className="px-3.5 py-2 rounded-xl bg-[#22222C] text-xs font-semibold text-zinc-300 cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={submitting}
                                className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#FF6B4A] to-[#FF9F43] text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                            >
                                {submitting ? 'Publishing...' : 'Publish Review'}
                            </button>
                        </div>
                    </form>
                )}
            </section>

            {/* Community & Personal Reviews Feed */}
            <section className="space-y-3.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-1.5 bg-[#18181F] p-1 rounded-xl border border-white/10 w-fit">
                        {(
                            [
                                { id: 'all', label: 'All Reviews' },
                                { id: 'friends', label: 'Friends' },
                                { id: 'mine', label: 'My Reviews' },
                            ] as { id: ReviewFilter; label: string }[]
                        ).map((tab) => (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setFilter(tab.id)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                                    filter === tab.id
                                        ? 'bg-[#FF6B4A] text-white'
                                        : 'text-zinc-400 hover:text-white'
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    <div className="relative sm:w-64">
                        <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                            type="text"
                            value={reviewSearch}
                            onChange={(e) => setReviewSearch(e.target.value)}
                            placeholder="Filter reviews..."
                            className="w-full bg-[#18181F] border border-white/10 focus:border-[#FF6B4A] rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none"
                        />
                    </div>
                </div>

                {visibleReviews.length === 0 ? (
                    <div className="bg-[#18181F] border border-white/10 rounded-2xl p-10 text-center space-y-1">
                        <MessageSquareText className="w-7 h-7 text-zinc-500 mx-auto" />
                        <p className="text-sm font-semibold text-zinc-200">No reviews match this view</p>
                        <p className="text-xs text-zinc-400">
                            Pick a title above to publish the first review!
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {visibleReviews.map((rev) => {
                            const isMine = rev.user_id === user?.id
                            const authorHandle = rev.profiles?.username ?? 'user'
                            const isShareOpen = openShareLogId === rev.id

                            return (
                                <article
                                    key={rev.id}
                                    className="bg-[#18181F] border border-white/10 rounded-2xl p-4 space-y-3"
                                >
                                    <div className="flex items-start gap-3.5">
                                        <button
                                            type="button"
                                            onClick={() =>
                                                onOpenMedia({
                                                    tmdb_id: rev.tmdb_id,
                                                    media_type: rev.media_type,
                                                    title: rev.title,
                                                    poster_path: rev.poster_path,
                                                })
                                            }
                                            className="shrink-0 cursor-pointer"
                                        >
                                            {rev.poster_path ? (
                                                <img
                                                    src={posterUrl(rev.poster_path, 'w185')}
                                                    alt={rev.title}
                                                    className="w-14 h-20 rounded-xl object-cover border border-white/10"
                                                />
                                            ) : (
                                                <div className="w-14 h-20 rounded-xl bg-[#22222C]" />
                                            )}
                                        </button>

                                        <div className="min-w-0 flex-1 space-y-1.5">
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            onOpenMedia({
                                                                tmdb_id: rev.tmdb_id,
                                                                media_type: rev.media_type,
                                                                title: rev.title,
                                                                poster_path: rev.poster_path,
                                                            })
                                                        }
                                                        className="text-sm font-bold text-white hover:text-[#FF9F43] transition truncate block text-left cursor-pointer"
                                                    >
                                                        {rev.title}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            navigate(isMine ? '/library' : `/profile/${rev.user_id}`)
                                                        }
                                                        className="text-[11px] text-zinc-400 hover:text-white cursor-pointer"
                                                    >
                                                        Reviewed by{' '}
                                                        <span className="text-zinc-200 font-semibold">@{authorHandle}</span>
                                                    </button>
                                                </div>

                                                {rev.rating !== null && (
                                                    <span className="px-2.5 py-1 rounded-lg bg-[#22222C] text-xs font-bold text-[#FF9F43] flex items-center gap-1 shrink-0">
                            <Star className="w-3.5 h-3.5 fill-[#FF9F43]" /> {rev.rating}/5
                          </span>
                                                )}
                                            </div>

                                            <p className="text-xs sm:text-sm text-zinc-200 leading-relaxed whitespace-pre-line">
                                                {rev.review_text}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Card Footer Actions: Edit (if mine) & Send Review to Chat/Forum */}
                                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/5">
                                        {isMine && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    selectTitleForReview({
                                                        tmdb_id: rev.tmdb_id,
                                                        media_type: rev.media_type,
                                                        title: rev.title,
                                                        poster_path: rev.poster_path,
                                                    })
                                                    window.scrollTo({ top: 0, behavior: 'smooth' })
                                                }}
                                                className="px-2.5 py-1 rounded-lg bg-[#22222C] hover:bg-[#2C2C38] text-[11px] font-semibold text-zinc-300 flex items-center gap-1 transition cursor-pointer"
                                            >
                                                <Edit3 className="w-3 h-3 text-[#FF9F43]" /> Edit
                                            </button>
                                        )}

                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSentFeedback(null)
                                                setOpenShareLogId(isShareOpen ? null : rev.id)
                                            }}
                                            className="px-2.5 py-1 rounded-lg bg-[#22222C] hover:bg-[#2C2C38] text-[11px] font-semibold text-zinc-300 hover:text-[#FF9F43] flex items-center gap-1 transition cursor-pointer"
                                        >
                                            <Send className="w-3 h-3" /> Send Review
                                        </button>
                                    </div>

                                    {isShareOpen && (
                                        <div className="ml-auto w-60 bg-[#22222C] border border-white/15 rounded-2xl p-2.5 shadow-2xl space-y-2">
                                            {sentFeedback ? (
                                                <p className="text-xs text-emerald-400 px-2 py-1 flex items-center gap-1">
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
                                                                    onClick={() =>
                                                                        handleShareReview(
                                                                            { type: 'forum', slug: forum.slug, label: forum.name },
                                                                            rev
                                                                        )
                                                                    }
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
                                                                    onClick={() =>
                                                                        handleShareReview(
                                                                            {
                                                                                type: 'dm',
                                                                                id: friend.id,
                                                                                label: `@${friend.username}`,
                                                                            },
                                                                            rev
                                                                        )
                                                                    }
                                                                    className="w-full text-left px-2.5 py-1.5 rounded-xl text-xs text-zinc-200 hover:bg-[#FF6B4A] hover:text-white transition cursor-pointer"
                                                                >
                                                                    @{friend.username}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {joinedForums.length === 0 && friends.length === 0 && (
                                                        <p className="text-[11px] text-zinc-400 px-2 py-1">
                                                            Join a forum or follow friends to send reviews.
                                                        </p>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    )}
                                </article>
                            )
                        })}
                    </div>
                )}
            </section>
        </div>
    )
}