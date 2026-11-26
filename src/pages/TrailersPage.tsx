import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
    Play,
    Pause,
    Volume2,
    VolumeX,
    Maximize,
    Sparkles,
    Plus,
    Heart,
    MessageCircle,
    Send,
    Bookmark,
    RotateCw,
    Star,
    Check,
    Trash2,
    UserPlus,
    X,
    Wand2,
    Flame,
} from 'lucide-react'
import { getTrending, getTrailerKey, posterUrl, type TMDBSearchResult } from '../lib/tmdb'
import { getPersonalizedRecommendations } from '../lib/recommendations'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { MediaLog, Profile, TrailerComment } from '../types/database'
import type { SelectedMedia } from '../components/media/MediaModal'

type TrailerFeedMode = 'for-you' | 'trending'

interface TrailerFeedItem extends TMDBSearchResult {
    reason?: string
}

const STORAGE_KEY_PREFIX = 'cinerate_last_trailer_id_'

function readSavedTrailerId(mode: TrailerFeedMode): number | null {
    try {
        const raw = sessionStorage.getItem(`${STORAGE_KEY_PREFIX}${mode}`)
        if (!raw) return null
        const parsed = Number(raw)
        return Number.isFinite(parsed) ? parsed : null
    } catch {
        return null
    }
}

function writeSavedTrailerId(mode: TrailerFeedMode, id: number | null) {
    try {
        const key = `${STORAGE_KEY_PREFIX}${mode}`
        if (id === null) sessionStorage.removeItem(key)
        else sessionStorage.setItem(key, String(id))
    } catch {
        // ignore storage errors
    }
}

function shuffleArray<T>(items: T[]): T[] {
    const copy = [...items]
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[copy[i], copy[j]] = [copy[j], copy[i]]
    }
    return copy
}

interface YTPlayerInstance {
    playVideo: () => void
    pauseVideo: () => void
    setVolume: (volume: number) => void
    mute: () => void
    unMute: () => void
    seekTo: (seconds: number, allowSeekAhead: boolean) => void
    getCurrentTime: () => number
    getDuration: () => number
    destroy: () => void
}

interface YTGlobal {
    Player: new (
        element: HTMLElement | string,
        options: {
            host?: string
            videoId: string
            playerVars?: Record<string, string | number>
            events?: {
                onReady?: (event: { target: YTPlayerInstance }) => void
                onStateChange?: (event: { data: number }) => void
            }
        }
    ) => YTPlayerInstance
    PlayerState?: {
        PLAYING: number
        PAUSED: number
        ENDED: number
    }
}

declare global {
    interface Window {
        YT?: YTGlobal
        onYouTubeIframeAPIReady?: () => void
    }
}

let ytApiPromise: Promise<void> | null = null
function loadYouTubeIframeAPI(): Promise<void> {
    if (window.YT && window.YT.Player) return Promise.resolve()
    if (ytApiPromise) return ytApiPromise

    ytApiPromise = new Promise<void>((resolve) => {
        const existingScript = document.querySelector('script[src="https://www.youtube.com/iframe_api"]')
        const prevCallback = window.onYouTubeIframeAPIReady
        window.onYouTubeIframeAPIReady = () => {
            prevCallback?.()
            resolve()
        }
        if (!existingScript) {
            const script = document.createElement('script')
            script.src = 'https://www.youtube.com/iframe_api'
            script.async = true
            document.body.appendChild(script)
        } else if (window.YT && window.YT.Player) {
            resolve()
        }
    })

    return ytApiPromise
}

function formatTime(sec: number): string {
    if (!Number.isFinite(sec) || sec < 0) return '0:00'
    const mins = Math.floor(sec / 60)
    const rem = Math.floor(sec % 60)
    return `${mins}:${rem.toString().padStart(2, '0')}`
}

interface TrailersPageProps {
    feedLogs: MediaLog[]
    myLogs: MediaLog[]
    friends: Profile[]
    friendIds: Set<string>
    outgoingRequestIds: Set<string>
    onFollowUser: (targetUserId: string) => Promise<void>
    onOpenMedia: (media: SelectedMedia) => void
    onLogsUpdated: () => void
}

interface ReelCardProps {
    item: TrailerFeedItem
    isActive: boolean
    volume: number
    isMuted: boolean
    isSaved: boolean
    isRefreshing: boolean
    friends: Profile[]
    friendIds: Set<string>
    outgoingRequestIds: Set<string>
    onFollowUser: (targetUserId: string) => Promise<void>
    onVolumeChange: (nextVol: number) => void
    onToggleMute: () => void
    onRegisterEl: (id: number, el: HTMLElement | null) => void
    onOpenMedia: (media: SelectedMedia) => void
    onToggleSave: (item: TMDBSearchResult) => Promise<void>
    onRefreshReels: () => Promise<void>
}

function ReelCard({
                      item,
                      isActive,
                      volume,
                      isMuted,
                      isSaved,
                      isRefreshing,
                      friends,
                      friendIds,
                      outgoingRequestIds,
                      onFollowUser,
                      onVolumeChange,
                      onToggleMute,
                      onRegisterEl,
                      onOpenMedia,
                      onToggleSave,
                      onRefreshReels,
                  }: ReelCardProps) {
    const { user, profile } = useAuth()
    const cardRef = useRef<HTMLElement | null>(null)
    const stageRef = useRef<HTMLDivElement | null>(null)
    const playerHostRef = useRef<HTMLDivElement | null>(null)
    const playerRef = useRef<YTPlayerInstance | null>(null)

    const [trailerKey, setTrailerKey] = useState<string | null>(null)
    const [trailerLoaded, setTrailerLoaded] = useState(false)
    const [isPlaying, setIsPlaying] = useState(false)
    const [currentTime, setCurrentTime] = useState(0)
    const [duration, setDuration] = useState(0)

    const latestPlaybackRef = useRef({ currentTime: 0, duration: 0 })
    latestPlaybackRef.current = { currentTime, duration }

    const [liked, setLiked] = useState(false)
    const [likeCount, setLikeCount] = useState(0)

    const [commentsOpen, setCommentsOpen] = useState(false)
    const [comments, setComments] = useState<TrailerComment[]>([])
    const [starRating, setStarRating] = useState(5)
    const [commentText, setCommentText] = useState('')
    const [postingComment, setPostingComment] = useState(false)
    const [commentError, setCommentError] = useState<string | null>(null)
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

    const [shareOpen, setShareOpen] = useState(false)
    const [sharedFeedback, setSharedFeedback] = useState<string | null>(null)
    const [savingBookmark, setSavingBookmark] = useState(false)

    const title = item.title || item.name || 'Untitled'
    const year = (item.release_date || item.first_air_date || '').slice(0, 4)

    useEffect(() => {
        onRegisterEl(item.id, cardRef.current)
        return () => onRegisterEl(item.id, null)
    }, [item.id, onRegisterEl])

    useEffect(() => {
        if (!isActive) {
            setCommentsOpen(false)
            setShareOpen(false)
        }
    }, [isActive])

    useEffect(() => {
        let cancelled = false
        getTrailerKey(item.media_type, item.id)
            .then((key) => {
                if (cancelled) return
                setTrailerKey(key)
                setTrailerLoaded(true)
            })
            .catch(() => {
                if (cancelled) return
                setTrailerKey(null)
                setTrailerLoaded(true)
            })
        return () => {
            cancelled = true
        }
    }, [item.id, item.media_type])

    useEffect(() => {
        const host = playerHostRef.current
        if (!isActive || !trailerKey || !host) {
            if (playerRef.current) {
                try {
                    playerRef.current.destroy()
                } catch {
                    // ignore
                }
                playerRef.current = null
            }
            if (host) host.innerHTML = ''
            setIsPlaying(false)
            setCurrentTime(0)
            setDuration(0)
            return
        }

        let cancelled = false

        loadYouTubeIframeAPI().then(() => {
            if (cancelled || !window.YT?.Player || !playerHostRef.current) return

            playerHostRef.current.innerHTML = ''
            const mountNode = document.createElement('div')
            mountNode.style.width = '100%'
            mountNode.style.height = '100%'
            playerHostRef.current.appendChild(mountNode)

            const instance = new window.YT.Player(mountNode, {
                host: 'https://www.youtube-nocookie.com',
                videoId: trailerKey,
                playerVars: {
                    autoplay: 1,
                    controls: 0,
                    disablekb: 1,
                    fs: 0,
                    iv_load_policy: 3,
                    loop: 1,
                    playlist: trailerKey,
                    playsinline: 1,
                    rel: 0,
                },
                events: {
                    onReady: (event) => {
                        if (cancelled) return
                        playerRef.current = event.target
                        event.target.setVolume(volume)
                        if (isMuted) event.target.mute()
                        else event.target.unMute()
                        event.target.playVideo()
                        setDuration(event.target.getDuration() || 0)
                        setIsPlaying(true)
                    },
                    onStateChange: (event) => {
                        if (cancelled) return
                        const PLAYING = window.YT?.PlayerState?.PLAYING ?? 1
                        const PAUSED = window.YT?.PlayerState?.PAUSED ?? 2
                        if (event.data === PLAYING) {
                            setIsPlaying(true)
                            setDuration(playerRef.current?.getDuration() || 0)
                        } else if (event.data === PAUSED) {
                            setIsPlaying(false)
                        }
                    },
                },
            })

            playerRef.current = instance
        })

        return () => {
            cancelled = true
            const { currentTime: watchedSec, duration: totalSec } = latestPlaybackRef.current
            if (user && trailerKey && watchedSec > 0.5) {
                const rate = totalSec > 0 ? Math.min(1, watchedSec / totalSec) : 0
                void supabase.from('trailer_views').upsert(
                    {
                        user_id: user.id,
                        tmdb_id: item.id,
                        media_type: item.media_type,
                        watch_seconds: Number(watchedSec.toFixed(1)),
                        duration_seconds: Number(totalSec.toFixed(1)),
                        completion_rate: Number(rate.toFixed(3)),
                        updated_at: new Date().toISOString(),
                    },
                    { onConflict: 'user_id,tmdb_id,media_type' }
                )
            }

            if (playerRef.current) {
                try {
                    playerRef.current.destroy()
                } catch {
                    // ignore
                }
                playerRef.current = null
            }
            if (playerHostRef.current) {
                playerHostRef.current.innerHTML = ''
            }
        }
    }, [isActive, trailerKey, user, item.id, item.media_type])

    useEffect(() => {
        const p = playerRef.current
        if (!p) return
        try {
            p.setVolume(volume)
            if (isMuted) p.mute()
            else p.unMute()
        } catch {
            // player not ready yet
        }
    }, [volume, isMuted, isActive])

    useEffect(() => {
        if (!isActive || !isPlaying) return
        const interval = setInterval(() => {
            const p = playerRef.current
            if (!p) return
            try {
                setCurrentTime(p.getCurrentTime() || 0)
                const dur = p.getDuration() || 0
                if (dur > 0) setDuration(dur)
            } catch {
                // ignore
            }
        }, 350)
        return () => clearInterval(interval)
    }, [isActive, isPlaying])

    useEffect(() => {
        let cancelled = false

        async function loadInteractions() {
            const [{ data: likesData }, { data: commentsData }] = await Promise.all([
                supabase
                    .from('trailer_likes')
                    .select('user_id')
                    .eq('tmdb_id', item.id)
                    .eq('media_type', item.media_type),
                supabase
                    .from('trailer_comments')
                    .select('*, profiles(id, username, avatar_url, created_at)')
                    .eq('tmdb_id', item.id)
                    .eq('media_type', item.media_type)
                    .order('created_at', { ascending: false }),
            ])

            if (cancelled) return
            if (likesData) {
                setLikeCount(likesData.length)
                setLiked(Boolean(user && likesData.some((l) => l.user_id === user.id)))
            }
            if (commentsData) {
                setComments(commentsData as TrailerComment[])
            }
        }

        loadInteractions()
        return () => {
            cancelled = true
        }
    }, [item.id, item.media_type, user])

    function handleTogglePlay() {
        const p = playerRef.current
        if (!p) return
        if (isPlaying) {
            p.pauseVideo()
            setIsPlaying(false)
        } else {
            p.playVideo()
            setIsPlaying(true)
        }
    }

    function handleSeek(nextSec: number) {
        setCurrentTime(nextSec)
        try {
            playerRef.current?.seekTo(nextSec, true)
        } catch {
            // ignore
        }
    }

    function handleFullscreen() {
        const el = stageRef.current
        if (!el) return
        if (document.fullscreenElement) {
            document.exitFullscreen?.().catch(() => {})
        } else {
            el.requestFullscreen?.().catch(() => {})
        }
    }

    async function handleToggleLike() {
        if (!user) return
        const nextLiked = !liked
        setLiked(nextLiked)
        setLikeCount((c) => (nextLiked ? c + 1 : Math.max(0, c - 1)))

        if (nextLiked) {
            await supabase.from('trailer_likes').insert({
                user_id: user.id,
                tmdb_id: item.id,
                media_type: item.media_type,
            })
        } else {
            await supabase
                .from('trailer_likes')
                .delete()
                .eq('user_id', user.id)
                .eq('tmdb_id', item.id)
                .eq('media_type', item.media_type)
        }
    }

    async function handlePostComment(e: React.FormEvent) {
        e.preventDefault()
        setCommentError(null)

        if (!user) {
            setCommentError('You must be signed in to post a review.')
            return
        }
        if (!commentText.trim()) return

        setPostingComment(true)

        const { data, error } = await supabase
            .from('trailer_comments')
            .insert({
                user_id: user.id,
                tmdb_id: item.id,
                media_type: item.media_type,
                rating: starRating,
                comment_text: commentText.trim(),
            })
            .select('*')
            .single()

        setPostingComment(false)

        if (error) {
            setCommentError(error.message)
            return
        }

        if (data) {
            const inserted: TrailerComment = {
                ...(data as TrailerComment),
                profiles: profile ?? {
                    id: user.id,
                    username: user.email?.split('@')[0] ?? 'you',
                    avatar_url: null,
                    created_at: new Date().toISOString(),
                },
            }
            setComments((prev) => [inserted, ...prev])
            setCommentText('')
        }
    }

    async function handleConfirmDeleteComment(commentId: string) {
        if (!user) return
        const previous = comments
        setConfirmDeleteId(null)
        setComments((prev) => prev.filter((c) => c.id !== commentId))

        const { error } = await supabase
            .from('trailer_comments')
            .delete()
            .eq('id', commentId)
            .eq('user_id', user.id)

        if (error) {
            setComments(previous)
            setCommentError(error.message)
        }
    }

    async function handleShareToFriend(friend: Profile) {
        if (!user) return
        await supabase.from('messages').insert({
            sender_id: user.id,
            receiver_id: friend.id,
            content: `Check out the trailer for ${title}!`,
            attached_tmdb_id: item.id,
            attached_media_type: item.media_type,
            attached_title: title,
            attached_poster: item.poster_path,
        })
        setSharedFeedback(`Sent to @${friend.username}`)
        setTimeout(() => {
            setSharedFeedback(null)
            setShareOpen(false)
        }, 1400)
    }

    async function handleCopyLink() {
        const shareUrl = `https://www.themoviedb.org/${item.media_type}/${item.id}`
        await navigator.clipboard?.writeText(shareUrl)
        setSharedFeedback('TMDB link copied!')
        setTimeout(() => {
            setSharedFeedback(null)
            setShareOpen(false)
        }, 1400)
    }

    const ratedComments = comments.filter((c) => c.rating !== null)
    const avgStars =
        ratedComments.length > 0
            ? (ratedComments.reduce((sum, c) => sum + (c.rating ?? 0), 0) / ratedComments.length).toFixed(1)
            : null

    return (
        <section
            ref={cardRef}
            data-media-id={item.id}
            className="h-full w-full snap-start snap-always shrink-0 flex items-center justify-center gap-4 py-1 overflow-anchor-none"
        >
            <div
                ref={stageRef}
                className="relative h-full flex-1 min-w-0 bg-[#14141A] border border-white/15 rounded-2xl overflow-hidden shadow-2xl flex flex-col justify-between"
            >
                <div className="relative flex-1 min-h-0 w-full bg-black flex items-center justify-center overflow-hidden">
                    {isActive && trailerKey ? (
                        <div
                            onClick={handleTogglePlay}
                            className="relative w-full h-full bg-black cursor-pointer select-none"
                        >
                            <div
                                ref={playerHostRef}
                                className="w-full h-full pointer-events-none"
                            />
                        </div>
                    ) : (
                        <div className="relative w-full h-full flex items-center justify-center">
                            {item.poster_path && (
                                <img
                                    src={posterUrl(item.poster_path, 'w500')}
                                    alt=""
                                    aria-hidden="true"
                                    className="absolute inset-0 w-full h-full object-cover blur-2xl opacity-30 scale-110 pointer-events-none"
                                />
                            )}
                            <div className="relative z-10 flex flex-col items-center gap-3 p-6 text-center">
                                {item.poster_path && (
                                    <img
                                        src={posterUrl(item.poster_path, 'w342')}
                                        alt={title}
                                        className="w-36 h-52 rounded-2xl object-cover shadow-2xl border border-white/15"
                                    />
                                )}
                                {trailerLoaded && !trailerKey && (
                                    <span className="px-3 py-1 rounded-full bg-black/70 border border-white/10 text-xs text-zinc-200">
                                        No trailer available on TMDB
                                    </span>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <div className="relative z-20 bg-[#14141A] border-t border-white/10 shrink-0">
                    {isActive && trailerKey && (
                        <div className="px-4 py-2 bg-black/70 border-b border-white/10 flex items-center gap-3">
                            <button
                                type="button"
                                onClick={handleTogglePlay}
                                title={isPlaying ? 'Pause' : 'Play'}
                                className="p-1.5 rounded-lg text-white hover:text-[#FF9F43] transition cursor-pointer shrink-0"
                            >
                                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
                            </button>

                            <span className="text-[11px] font-mono text-zinc-300 tabular-nums shrink-0">
                                {formatTime(currentTime)}
                            </span>

                            <input
                                type="range"
                                min={0}
                                max={duration > 0 ? duration : 100}
                                step={0.5}
                                value={Math.min(currentTime, duration > 0 ? duration : 100)}
                                onChange={(e) => handleSeek(Number(e.target.value))}
                                aria-label="Seek timeline"
                                className="flex-1 min-w-0 h-1.5 accent-[#FF6B4A] bg-white/20 rounded-lg cursor-pointer"
                            />

                            <span className="text-[11px] font-mono text-zinc-400 tabular-nums shrink-0">
                                {formatTime(duration)}
                            </span>

                            <button
                                type="button"
                                onClick={onToggleMute}
                                title={isMuted ? 'Unmute' : 'Mute'}
                                className="p-1.5 rounded-lg text-white hover:text-[#FF9F43] transition cursor-pointer shrink-0"
                            >
                                {isMuted || volume === 0 ? (
                                    <VolumeX className="w-4 h-4 text-zinc-400" />
                                ) : (
                                    <Volume2 className="w-4 h-4 text-[#FF9F43]" />
                                )}
                            </button>

                            <input
                                type="range"
                                min={0}
                                max={100}
                                value={isMuted ? 0 : volume}
                                onChange={(e) => onVolumeChange(Number(e.target.value))}
                                aria-label="Volume adjuster"
                                className="w-20 hidden sm:block h-1.5 accent-[#FF9F43] bg-white/20 rounded-lg cursor-pointer shrink-0"
                            />

                            <button
                                type="button"
                                onClick={handleFullscreen}
                                title="Fullscreen"
                                className="p-1.5 rounded-lg text-white hover:text-[#FF9F43] transition cursor-pointer shrink-0"
                            >
                                <Maximize className="w-4 h-4" />
                            </button>
                        </div>
                    )}

                    <div className="px-4 py-3 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                            {item.poster_path ? (
                                <img
                                    src={posterUrl(item.poster_path, 'w185')}
                                    alt={title}
                                    className="w-10 h-14 rounded-xl object-cover border border-white/15 shrink-0"
                                />
                            ) : (
                                <div className="w-10 h-14 rounded-xl bg-[#22222C] shrink-0" />
                            )}

                            <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <h2 className="text-sm sm:text-base font-bold text-white truncate">{title}</h2>
                                    <span className="text-[11px] text-zinc-400 shrink-0">
                                        {item.media_type === 'tv' ? 'TV Series' : 'Movie'}
                                        {year ? ` • ${year}` : ''}
                                    </span>
                                    {item.reason && (
                                        <span className="px-2 py-0.5 rounded-md bg-[#FF6B4A]/15 border border-[#FF6B4A]/30 text-[11px] font-semibold text-[#FF9F43] shrink-0">
                                            {item.reason}
                                        </span>
                                    )}
                                    {avgStars && (
                                        <span className="px-2 py-0.5 rounded-lg bg-[#22222C] text-[11px] font-semibold text-[#FF9F43] shrink-0">
                                            ★ {avgStars} ({ratedComments.length})
                                        </span>
                                    )}
                                </div>

                                {item.overview && (
                                    <p className="text-xs text-zinc-300 line-clamp-1 mt-1">{item.overview}</p>
                                )}
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={() =>
                                onOpenMedia({
                                    tmdb_id: item.id,
                                    media_type: item.media_type,
                                    title,
                                    poster_path: item.poster_path,
                                    overview: item.overview,
                                })
                            }
                            className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-[#FF6B4A] to-[#FF9F43] text-white text-xs font-semibold flex items-center gap-1.5 hover:opacity-95 transition cursor-pointer shrink-0"
                        >
                            <Plus className="w-3.5 h-3.5" /> Log / Rate
                        </button>
                    </div>
                </div>

                {commentsOpen && (
                    <div className="absolute inset-x-0 bottom-0 z-30 h-[62%] bg-[#18181F]/95 backdrop-blur-md border-t border-white/15 rounded-t-2xl p-4 flex flex-col">
                        <div className="flex items-center justify-between pb-2.5 border-b border-white/10">
                            <span className="text-xs font-bold text-white">
                                Trailer Reviews ({comments.length})
                            </span>
                            <button
                                type="button"
                                onClick={() => setCommentsOpen(false)}
                                className="text-zinc-400 hover:text-white cursor-pointer p-1"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <form onSubmit={handlePostComment} className="py-2.5 border-b border-white/10 space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-[11px] text-zinc-400">Your rating:</span>
                                <div className="flex items-center gap-1">
                                    {[1, 2, 3, 4, 5].map((star) => (
                                        <button
                                            key={star}
                                            type="button"
                                            onClick={() => setStarRating(star)}
                                            className="p-0.5 cursor-pointer"
                                        >
                                            <Star
                                                className={`w-4 h-4 transition ${
                                                    star <= starRating ? 'text-[#FF9F43] fill-[#FF9F43]' : 'text-zinc-600'
                                                }`}
                                            />
                                        </button>
                                    ))}
                                    <span className="text-[11px] text-zinc-400 ml-1">{starRating}/5</span>
                                </div>
                            </div>

                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder="Write your thoughts on this trailer..."
                                    value={commentText}
                                    onChange={(e) => setCommentText(e.target.value)}
                                    className="flex-1 min-w-0 bg-[#22222C] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#FF6B4A]"
                                />
                                <button
                                    type="submit"
                                    disabled={postingComment || !commentText.trim()}
                                    className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-[#FF6B4A] to-[#FF9F43] text-white text-xs font-semibold disabled:opacity-40 cursor-pointer shrink-0"
                                >
                                    {postingComment ? '...' : 'Post'}
                                </button>
                            </div>

                            {commentError && <p className="text-[11px] text-red-400">{commentError}</p>}
                        </form>

                        <div className="flex-1 overflow-y-auto pt-2.5 space-y-2 pr-1">
                            {comments.length === 0 ? (
                                <p className="text-xs text-zinc-500 text-center py-6">
                                    No trailer reviews yet. Be the first!
                                </p>
                            ) : (
                                comments.map((c) => {
                                    const isOwnComment = user?.id === c.user_id
                                    const isFollowing = friendIds.has(c.user_id)
                                    const isRequested = outgoingRequestIds.has(c.user_id)
                                    const isConfirming = confirmDeleteId === c.id

                                    return (
                                        <div key={c.id} className="bg-[#22222C]/80 border border-white/5 rounded-xl p-2.5">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                    <span className="text-xs font-semibold text-white truncate">
                                                        @{c.profiles?.username ?? 'user'}
                                                    </span>

                                                    {!isOwnComment && !isFollowing && (
                                                        isRequested ? (
                                                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-zinc-400">
                                                                Requested
                                                            </span>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                onClick={() => onFollowUser(c.user_id)}
                                                                className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#FF6B4A]/20 hover:bg-[#FF6B4A] text-[#FF6B4A] hover:text-white flex items-center gap-0.5 transition cursor-pointer"
                                                            >
                                                                <UserPlus className="w-2.5 h-2.5" /> Follow
                                                            </button>
                                                        )
                                                    )}
                                                </div>

                                                <div className="flex items-center gap-1.5 shrink-0">
                                                    {c.rating && (
                                                        <div className="flex items-center gap-0.5">
                                                            {Array.from({ length: c.rating }).map((_, idx) => (
                                                                <Star
                                                                    key={idx}
                                                                    className="w-3 h-3 text-[#FF9F43] fill-[#FF9F43]"
                                                                />
                                                            ))}
                                                        </div>
                                                    )}

                                                    {isOwnComment && (
                                                        isConfirming ? (
                                                            <div className="flex items-center gap-1">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleConfirmDeleteComment(c.id)}
                                                                    className="px-1.5 py-0.5 rounded bg-red-500 text-white text-[10px] font-bold cursor-pointer"
                                                                >
                                                                    Confirm
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setConfirmDeleteId(null)}
                                                                    className="px-1.5 py-0.5 rounded bg-[#18181F] text-zinc-300 text-[10px] cursor-pointer"
                                                                >
                                                                    Cancel
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                onClick={() => setConfirmDeleteId(c.id)}
                                                                title="Delete review"
                                                                className="text-zinc-500 hover:text-red-400 transition cursor-pointer p-0.5"
                                                            >
                                                                <Trash2 className="w-3.5 h-3.5" />
                                                            </button>
                                                        )
                                                    )}
                                                </div>
                                            </div>
                                            <p className="text-xs text-zinc-300 mt-1">{c.comment_text}</p>
                                        </div>
                                    )
                                })
                            )}
                        </div>
                    </div>
                )}
            </div>

            <div className="flex flex-col items-center justify-end gap-4 pb-3 shrink-0 relative">
                <button
                    type="button"
                    onClick={handleToggleLike}
                    className="flex flex-col items-center gap-1 group cursor-pointer"
                >
                    <div className="p-2.5 rounded-full bg-[#18181F] border border-white/10 group-hover:bg-[#22222C] transition">
                        <Heart
                            className={`w-6 h-6 transition ${
                                liked ? 'fill-[#FF6B4A] text-[#FF6B4A]' : 'text-white'
                            }`}
                        />
                    </div>
                    <span className="text-[11px] font-semibold text-zinc-300">{likeCount}</span>
                </button>

                <button
                    type="button"
                    onClick={() => setCommentsOpen((o) => !o)}
                    className="flex flex-col items-center gap-1 group cursor-pointer"
                >
                    <div
                        className={`p-2.5 rounded-full border transition ${
                            commentsOpen
                                ? 'bg-[#FF9F43]/20 border-[#FF9F43] text-[#FF9F43]'
                                : 'bg-[#18181F] border-white/10 text-white group-hover:bg-[#22222C]'
                        }`}
                    >
                        <MessageCircle className="w-6 h-6" />
                    </div>
                    <span className="text-[11px] font-semibold text-zinc-300">{comments.length}</span>
                </button>

                <div className="relative flex flex-col items-center">
                    <button
                        type="button"
                        onClick={() => setShareOpen((o) => !o)}
                        className="flex flex-col items-center gap-1 group cursor-pointer"
                    >
                        <div className="p-2.5 rounded-full bg-[#18181F] border border-white/10 group-hover:bg-[#22222C] transition">
                            <Send className="w-6 h-6 text-white" />
                        </div>
                        <span className="text-[11px] font-semibold text-zinc-300">Share</span>
                    </button>

                    {shareOpen && (
                        <div className="absolute right-14 bottom-0 z-40 w-52 bg-[#22222C] border border-white/15 rounded-2xl p-2.5 shadow-2xl space-y-1.5">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 px-2">
                                Send Trailer To
                            </p>

                            {sharedFeedback ? (
                                <p className="text-xs text-emerald-400 px-2 py-1.5 flex items-center gap-1">
                                    <Check className="w-3.5 h-3.5" /> {sharedFeedback}
                                </p>
                            ) : (
                                <>
                                    {friends.map((f) => (
                                        <button
                                            key={f.id}
                                            type="button"
                                            onClick={() => handleShareToFriend(f)}
                                            className="w-full text-left px-2.5 py-1.5 rounded-xl text-xs text-zinc-200 hover:bg-[#FF6B4A] hover:text-white transition cursor-pointer"
                                        >
                                            @{f.username}
                                        </button>
                                    ))}
                                    <button
                                        type="button"
                                        onClick={handleCopyLink}
                                        className="w-full text-left px-2.5 py-1.5 rounded-xl text-xs text-zinc-300 hover:bg-white/10 transition cursor-pointer border-t border-white/10 pt-2"
                                    >
                                        Copy TMDB link
                                    </button>
                                </>
                            )}
                        </div>
                    )}
                </div>

                <button
                    type="button"
                    disabled={savingBookmark}
                    onClick={async () => {
                        setSavingBookmark(true)
                        await onToggleSave(item)
                        setSavingBookmark(false)
                    }}
                    className="flex flex-col items-center gap-1 group cursor-pointer"
                >
                    <div className="p-2.5 rounded-full bg-[#18181F] border border-white/10 group-hover:bg-[#22222C] transition">
                        <Bookmark
                            className={`w-6 h-6 transition ${
                                isSaved ? 'fill-[#FF9F43] text-[#FF9F43]' : 'text-white'
                            }`}
                        />
                    </div>
                    <span className="text-[11px] font-semibold text-zinc-300">
                        {isSaved ? 'Saved' : 'Save'}
                    </span>
                </button>

                <button
                    type="button"
                    disabled={isRefreshing}
                    onClick={onRefreshReels}
                    title="Refresh reels with a new batch"
                    className="flex flex-col items-center gap-1 group cursor-pointer disabled:opacity-50"
                >
                    <div className="p-2.5 rounded-full bg-[#18181F] border border-white/10 group-hover:bg-[#22222C] transition">
                        <RotateCw
                            className={`w-6 h-6 text-white transition ${
                                isRefreshing ? 'animate-spin text-[#FF9F43]' : 'group-hover:text-[#FF9F43]'
                            }`}
                        />
                    </div>
                    <span className="text-[11px] font-semibold text-zinc-300">Refresh</span>
                </button>
            </div>
        </section>
    )
}

export function TrailersPage({
                                 feedLogs,
                                 myLogs,
                                 friends,
                                 friendIds,
                                 outgoingRequestIds,
                                 onFollowUser,
                                 onOpenMedia,
                                 onLogsUpdated,
                             }: TrailersPageProps) {
    const { user, profile } = useAuth()
    const [feedMode, setFeedMode] = useState<TrailerFeedMode>('for-you')
    const [itemsList, setItemsList] = useState<TrailerFeedItem[]>([])
    const [activeId, setActiveId] = useState<number | null>(null)
    const [volume, setVolume] = useState(70)
    const [isMuted, setIsMuted] = useState(true)
    const [loading, setLoading] = useState(true)
    const [loadingMore, setLoadingMore] = useState(false)
    const [isRefreshing, setIsRefreshing] = useState(false)
    const [page, setPage] = useState(1)
    const [hasMore, setHasMore] = useState(true)
    const [errorMsg, setErrorMsg] = useState<string | null>(null)
    const scrollRef = useRef<HTMLDivElement | null>(null)
    const restoredForBatchRef = useRef(false)
    const cardEls = useRef<Record<number, HTMLElement>>({})

    const buildInitialFeed = useCallback(
        async (mode: TrailerFeedMode): Promise<TrailerFeedItem[]> => {
            if (mode === 'trending' || !user) {
                const trendingItems = await getTrending(1)
                return shuffleArray(trendingItems)
            }

            const [recs, trendingItems] = await Promise.all([
                getPersonalizedRecommendations({
                    userId: user.id,
                    profile,
                    myLogs,
                    feedLogs,
                    friendIds,
                }),
                getTrending(1),
            ])

            const combined: TrailerFeedItem[] = []
            const seen = new Set<string>()

            for (const rec of recs) {
                const key = `${rec.media_type}-${rec.id}`
                if (seen.has(key)) continue
                seen.add(key)
                combined.push({
                    id: rec.id,
                    media_type: rec.media_type,
                    title: rec.title,
                    poster_path: rec.poster_path,
                    backdrop_path: null,
                    vote_average: 0,
                    overview: rec.overview,
                    release_date: rec.release_date,
                    reason: rec.reason,
                })
            }

            for (const tr of shuffleArray(trendingItems)) {
                const key = `${tr.media_type}-${tr.id}`
                if (seen.has(key)) continue
                seen.add(key)
                combined.push(tr)
            }

            return combined
        },
        [user, profile, myLogs, feedLogs, friendIds]
    )

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        setErrorMsg(null)
        restoredForBatchRef.current = false

        buildInitialFeed(feedMode)
            .then((items) => {
                if (cancelled) return
                setItemsList(items)
                setPage(1)
                setHasMore(items.length > 0)

                const savedId = readSavedTrailerId(feedMode)
                const matched = savedId !== null ? items.find((t) => t.id === savedId) : undefined
                const initialId = matched?.id ?? items[0]?.id ?? null
                setActiveId(initialId)
                if (initialId !== null) writeSavedTrailerId(feedMode, initialId)
            })
            .catch((err) => {
                if (cancelled) return
                setErrorMsg(err instanceof Error ? err.message : 'Could not load trailers')
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })

        return () => {
            cancelled = true
        }
    }, [feedMode, buildInitialFeed])

    useLayoutEffect(() => {
        if (loading || restoredForBatchRef.current || itemsList.length === 0) return
        const container = scrollRef.current
        if (!container) return

        const savedId = readSavedTrailerId(feedMode)
        const idx = savedId !== null ? itemsList.findIndex((t) => t.id === savedId) : -1
        if (idx > 0 && container.clientHeight > 0) {
            container.scrollTop = idx * container.clientHeight
        } else {
            container.scrollTop = 0
        }
        restoredForBatchRef.current = true
    }, [loading, itemsList, feedMode])

    const loadNextPage = useCallback(async () => {
        if (loadingMore || !hasMore) return
        setLoadingMore(true)
        const nextPage = page + 1
        try {
            const nextItems = await getTrending(nextPage)
            if (nextItems.length === 0) {
                setHasMore(false)
            } else {
                setItemsList((prev) => {
                    const seen = new Set(prev.map((p) => `${p.media_type}-${p.id}`))
                    const fresh = shuffleArray(
                        nextItems.filter((n) => !seen.has(`${n.media_type}-${n.id}`))
                    )
                    return [...prev, ...fresh]
                })
                setPage(nextPage)
            }
        } catch (err) {
            console.error('Failed to load more trailers:', err)
        } finally {
            setLoadingMore(false)
        }
    }, [loadingMore, hasMore, page])

    const handleRefreshReels = useCallback(async () => {
        if (isRefreshing) return
        setIsRefreshing(true)
        setErrorMsg(null)

        try {
            if (feedMode === 'for-you' && user) {
                const freshFeed = await buildInitialFeed('for-you')
                setItemsList(freshFeed)
                setPage(1)
                setHasMore(freshFeed.length > 0)

                const firstId = freshFeed[0]?.id ?? null
                setActiveId(firstId)
                writeSavedTrailerId('for-you', firstId)
                if (scrollRef.current) scrollRef.current.scrollTop = 0
                return
            }

            const targetPage = page >= 5 ? 1 : page + 1
            let items = await getTrending(targetPage)
            if (items.length === 0) {
                items = await getTrending(1)
                setPage(1)
            } else {
                setPage(targetPage)
            }

            const shuffled = shuffleArray(items)
            setItemsList(shuffled)
            setHasMore(items.length > 0)

            const firstId = shuffled[0]?.id ?? null
            setActiveId(firstId)
            writeSavedTrailerId(feedMode, firstId)

            if (scrollRef.current) {
                scrollRef.current.scrollTop = 0
            }
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Could not refresh trailers')
        } finally {
            setIsRefreshing(false)
        }
    }, [isRefreshing, feedMode, user, buildInitialFeed, page])

    useEffect(() => {
        if (itemsList.length === 0 || activeId === null) return
        const currentIndex = itemsList.findIndex((t) => t.id === activeId)
        if (currentIndex >= itemsList.length - 3) {
            loadNextPage()
        }
    }, [activeId, itemsList, loadNextPage])

    const registerEl = useCallback((id: number, el: HTMLElement | null) => {
        if (el) {
            cardEls.current[id] = el
        } else {
            delete cardEls.current[id]
        }
    }, [])

    const handleScroll = useCallback(() => {
        const container = scrollRef.current
        if (!container || itemsList.length === 0) return

        const reelHeight = container.clientHeight
        if (reelHeight <= 0) return

        const index = Math.round(container.scrollTop / reelHeight)
        const clampedIndex = Math.max(0, Math.min(itemsList.length - 1, index))
        const nextItem = itemsList[clampedIndex]
        if (nextItem && nextItem.id !== activeId) {
            setActiveId(nextItem.id)
            writeSavedTrailerId(feedMode, nextItem.id)
        }
    }, [itemsList, activeId, feedMode])

    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
            const target = e.target as HTMLElement | null
            if (
                target &&
                (target.tagName === 'INPUT' ||
                    target.tagName === 'TEXTAREA' ||
                    target.isContentEditable)
            ) {
                return
            }

            const container = scrollRef.current
            if (!container || itemsList.length === 0) return
            const reelHeight = container.clientHeight
            if (reelHeight <= 0) return

            e.preventDefault()
            const currentIdx = Math.round(container.scrollTop / reelHeight)
            const nextIdx =
                e.key === 'ArrowDown'
                    ? Math.min(itemsList.length - 1, currentIdx + 1)
                    : Math.max(0, currentIdx - 1)

            container.scrollTo({ top: nextIdx * reelHeight, behavior: 'auto' })
            const nextId = itemsList[nextIdx].id
            setActiveId(nextId)
            writeSavedTrailerId(feedMode, nextId)
        }

        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [itemsList, feedMode])

    function handleVolumeChange(nextVol: number) {
        setVolume(nextVol)
        setIsMuted(nextVol === 0)
    }

    function handleToggleMute() {
        if (isMuted && volume === 0) setVolume(70)
        setIsMuted((m) => !m)
    }

    async function handleToggleSave(item: TMDBSearchResult) {
        if (!user) return
        const existing = myLogs.find(
            (l) => l.tmdb_id === item.id && l.media_type === item.media_type
        )

        if (existing) {
            await supabase.from('media_logs').delete().eq('id', existing.id)
        } else {
            await supabase.from('media_logs').insert({
                user_id: user.id,
                tmdb_id: item.id,
                media_type: item.media_type,
                title: item.title || item.name || 'Untitled',
                poster_path: item.poster_path,
                status: 'watchlist',
            })
        }
        onLogsUpdated()
    }

    const myWatchlistIds = new Set(
        myLogs.filter((l) => l.status === 'watchlist').map((l) => `${l.media_type}-${l.tmdb_id}`)
    )
    const matches = feedLogs.filter(
        (l) =>
            l.status === 'watchlist' &&
            !myLogs.some((m) => m.id === l.id) &&
            myWatchlistIds.has(`${l.media_type}-${l.tmdb_id}`)
    )

    return (
        <div className="relative h-[calc(100dvh-96px)] flex flex-col">
            <div className="mb-2 flex items-center justify-between gap-2 shrink-0">
                <div className="inline-flex items-center gap-1 bg-[#18181F] border border-white/10 p-1 rounded-xl">
                    <button
                        type="button"
                        onClick={() => setFeedMode('for-you')}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                            feedMode === 'for-you'
                                ? 'bg-gradient-to-r from-[#FF6B4A] to-[#FF9F43] text-white'
                                : 'text-zinc-400 hover:text-white'
                        }`}
                    >
                        <Wand2 className="w-3.5 h-3.5" /> For You
                    </button>

                    <button
                        type="button"
                        onClick={() => setFeedMode('trending')}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                            feedMode === 'trending'
                                ? 'bg-gradient-to-r from-[#FF6B4A] to-[#FF9F43] text-white'
                                : 'text-zinc-400 hover:text-white'
                        }`}
                    >
                        <Flame className="w-3.5 h-3.5" /> Trending
                    </button>
                </div>

                {matches.length > 0 && (
                    <div className="rounded-xl bg-gradient-to-r from-[#FF6B4A]/20 to-[#FF9F43]/20 border border-[#FF6B4A]/40 px-3 py-1 flex items-center text-xs min-w-0">
                        <span className="text-[#FF9F43] font-semibold flex items-center gap-1.5 truncate">
                            <Sparkles className="w-3.5 h-3.5 shrink-0" />
                            Watchlist Match: {matches[0].title} with @{matches[0].profiles?.username}
                        </span>
                    </div>
                )}
            </div>

            {loading ? (
                <div className="flex-1 flex items-center justify-center text-xs text-zinc-400">
                    {feedMode === 'for-you' ? 'Personalizing your reels...' : 'Loading trending trailers...'}
                </div>
            ) : errorMsg ? (
                <div className="bg-[#18181F] border border-red-500/30 rounded-2xl p-4 text-xs text-red-300">
                    {errorMsg}
                </div>
            ) : (
                <div
                    ref={scrollRef}
                    onScroll={handleScroll}
                    className="flex-1 min-h-0 overflow-y-auto snap-y snap-mandatory overflow-anchor-none"
                >
                    {itemsList.map((item) => (
                        <ReelCard
                            key={`${feedMode}-${item.media_type}-${item.id}`}
                            item={item}
                            isActive={activeId === item.id}
                            volume={volume}
                            isMuted={isMuted}
                            isSaved={myLogs.some(
                                (l) => l.tmdb_id === item.id && l.media_type === item.media_type
                            )}
                            isRefreshing={isRefreshing}
                            friends={friends}
                            friendIds={friendIds}
                            outgoingRequestIds={outgoingRequestIds}
                            onFollowUser={onFollowUser}
                            onVolumeChange={handleVolumeChange}
                            onToggleMute={handleToggleMute}
                            onRegisterEl={registerEl}
                            onOpenMedia={onOpenMedia}
                            onToggleSave={handleToggleSave}
                            onRefreshReels={handleRefreshReels}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}