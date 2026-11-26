import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    Bookmark,
    Check,
    Edit3,
    Eye,
    Heart,
    MessageCircle,
    Play,
    Plus,
    Star,
    Tv,
    Film,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { posterUrl } from '../../lib/tmdb'
import type { LogComment, MediaLog } from '../../types/database'
import type { SelectedMedia } from '../media/MediaModal'

interface FeedCardProps {
    log: MediaLog
    viewerLog?: MediaLog
    isOwnLog: boolean
    togglingWatchlist?: boolean
    onToggleWatchlist?: (log: MediaLog) => void
    onWatchTrailer?: (media: SelectedMedia) => void
    onOpenMedia?: (media: SelectedMedia) => void
}

function formatRelativeDate(iso: string): string {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return ''
    const diffMs = Date.now() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
}

export function FeedCard({
                             log,
                             viewerLog,
                             isOwnLog,
                             togglingWatchlist = false,
                             onToggleWatchlist,
                             onWatchTrailer,
                             onOpenMedia,
                         }: FeedCardProps) {
    const { user, profile } = useAuth()
    const navigate = useNavigate()

    const [liked, setLiked] = useState(false)
    const [likeCount, setLikeCount] = useState(0)
    const [commentsOpen, setCommentsOpen] = useState(false)
    const [comments, setComments] = useState<LogComment[]>([])
    const [replyText, setReplyText] = useState('')
    const [postingReply, setPostingReply] = useState(false)

    useEffect(() => {
        let cancelled = false
        Promise.all([
            supabase.from('log_likes').select('user_id').eq('log_id', log.id),
            supabase
                .from('log_comments')
                .select('*, profiles(id, username, display_name, avatar_url, created_at)')
                .eq('log_id', log.id)
                .order('created_at', { ascending: true }),
        ]).then(([{ data: likesRows }, { data: commentRows }]) => {
            if (cancelled) return
            if (likesRows) {
                setLikeCount(likesRows.length)
                setLiked(Boolean(user && likesRows.some((r) => r.user_id === user.id)))
            }
            if (commentRows) {
                setComments(commentRows as LogComment[])
            }
        })
        return () => {
            cancelled = true
        }
    }, [log.id, user])

    async function handleToggleLike() {
        if (!user) return
        const next = !liked
        setLiked(next)
        setLikeCount((c) => (next ? c + 1 : Math.max(0, c - 1)))

        if (next) {
            await supabase.from('log_likes').insert({ log_id: log.id, user_id: user.id })
        } else {
            await supabase
                .from('log_likes')
                .delete()
                .eq('log_id', log.id)
                .eq('user_id', user.id)
        }
    }

    async function handlePostReply(e: React.FormEvent) {
        e.preventDefault()
        if (!user || !replyText.trim()) return
        setPostingReply(true)
        const { data } = await supabase
            .from('log_comments')
            .insert({
                log_id: log.id,
                user_id: user.id,
                comment_text: replyText.trim(),
            })
            .select('*')
            .single()
        setPostingReply(false)

        if (data) {
            setComments((prev) => [
                ...prev,
                {
                    ...(data as LogComment),
                    profiles: profile ?? {
                        id: user.id,
                        username: user.email?.split('@')[0] ?? 'you',
                        avatar_url: null,
                        created_at: new Date().toISOString(),
                    },
                },
            ])
            setReplyText('')
        }
    }

    const authorHandle = log.profiles?.username ?? 'user'
    const authorDisplay = log.profiles?.display_name || `@${authorHandle}`
    const inViewerWatchlist = viewerLog?.status === 'watchlist'
    const viewerWatched = viewerLog?.status === 'watched'

    const statusConfig = {
        watched: {
            verb: 'watched',
            badgeClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
            icon: Eye,
        },
        watching: {
            verb: 'is watching',
            badgeClass: 'bg-[#FF6B4A]/15 text-[#FF9F43] border-[#FF6B4A]/30',
            icon: Tv,
        },
        watchlist: {
            verb: 'saved to watchlist',
            badgeClass: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
            icon: Bookmark,
        },
    }[log.status]

    const StatusIcon = statusConfig.icon

    const mediaPayload: SelectedMedia = {
        tmdb_id: log.tmdb_id,
        media_type: log.media_type,
        title: log.title,
        poster_path: log.poster_path,
    }

    return (
        <article className="bg-[#18181F] hover:border-white/20 border border-white/10 rounded-2xl p-4 transition">
            <div className="flex items-start gap-3.5 sm:gap-4">
                <button
                    type="button"
                    onClick={() => (onWatchTrailer ? onWatchTrailer(mediaPayload) : onOpenMedia?.(mediaPayload))}
                    className="relative w-16 h-24 sm:w-20 sm:h-28 rounded-xl overflow-hidden bg-[#22222C] border border-white/10 shrink-0 group cursor-pointer"
                >
                    {log.poster_path ? (
                        <img
                            src={posterUrl(log.poster_path, 'w185')}
                            alt={log.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-zinc-500">
                            <Film className="w-5 h-5" />
                        </div>
                    )}
                    <span className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                        <span className="w-8 h-8 rounded-full bg-[#FF6B4A] text-white flex items-center justify-center shadow-lg">
                            <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                        </span>
                    </span>
                </button>

                <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-wrap">
                            <button
                                type="button"
                                onClick={() => navigate(isOwnLog ? '/library' : `/profile/${log.user_id}`)}
                                className="flex items-center gap-2 min-w-0 text-left group cursor-pointer"
                            >
                                {log.profiles?.avatar_url ? (
                                    <img
                                        src={log.profiles.avatar_url}
                                        alt={authorHandle}
                                        className="w-6 h-6 rounded-full object-cover border border-white/15 shrink-0"
                                    />
                                ) : (
                                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#FF6B4A] to-[#FF9F43] flex items-center justify-center text-[10px] font-bold uppercase text-white shrink-0">
                                        {authorHandle[0]}
                                    </div>
                                )}
                                <span className="text-xs font-bold text-white group-hover:text-[#FF9F43] transition truncate">
                                    {authorDisplay}
                                </span>
                            </button>

                            <span className="text-xs text-zinc-400">{statusConfig.verb}</span>
                        </div>

                        <span className="text-[11px] text-zinc-500 shrink-0">
                            {formatRelativeDate(log.updated_at)}
                        </span>
                    </div>

                    <div className="flex items-start justify-between gap-2">
                        <button
                            type="button"
                            onClick={() => onOpenMedia?.(mediaPayload)}
                            className="text-sm sm:text-base font-bold text-white hover:text-[#FF9F43] transition text-left truncate cursor-pointer"
                        >
                            {log.title}
                        </button>

                        {log.rating !== null && (
                            <span className="px-2 py-0.5 rounded-lg bg-[#22222C] border border-white/10 text-xs font-bold text-[#FF9F43] flex items-center gap-1 shrink-0">
                                <Star className="w-3 h-3 fill-[#FF9F43]" /> {log.rating}/5
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-semibold capitalize ${statusConfig.badgeClass}`}
                        >
                            <StatusIcon className="w-2.5 h-2.5" />
                            {log.status}
                        </span>

                        <span className="px-2 py-0.5 rounded-md bg-[#22222C] text-[10px] font-semibold text-zinc-300">
                            {log.media_type === 'tv'
                                ? `S${log.season}:E${log.episode}`
                                : 'Movie'}
                        </span>

                        {!isOwnLog && viewerWatched && (
                            <span className="px-2 py-0.5 rounded-md bg-white/5 text-[10px] font-medium text-zinc-400 flex items-center gap-1">
                                <Check className="w-2.5 h-2.5 text-emerald-400" /> You watched
                            </span>
                        )}
                    </div>

                    {log.review_text && log.review_text.trim().length > 0 && (
                        <blockquote className="bg-[#14141A] border-l-2 border-[#FF6B4A] rounded-r-xl px-3 py-2 text-xs text-zinc-200 leading-relaxed whitespace-pre-line">
                            “{log.review_text}”
                        </blockquote>
                    )}

                    <div className="pt-1 flex items-center gap-2 flex-wrap">
                        <button
                            type="button"
                            onClick={handleToggleLike}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition cursor-pointer ${
                                liked
                                    ? 'bg-[#FF6B4A]/20 text-[#FF6B4A] border border-[#FF6B4A]/40'
                                    : 'bg-[#22222C] hover:bg-[#2C2C38] text-zinc-300'
                            }`}
                        >
                            <Heart className={`w-3 h-3 ${liked ? 'fill-current' : ''}`} /> {likeCount}
                        </button>

                        <button
                            type="button"
                            onClick={() => setCommentsOpen((o) => !o)}
                            className="px-2.5 py-1 rounded-lg bg-[#22222C] hover:bg-[#2C2C38] text-[11px] font-semibold text-zinc-300 hover:text-white flex items-center gap-1 transition cursor-pointer"
                        >
                            <MessageCircle className="w-3 h-3 text-[#FF9F43]" /> {comments.length}
                        </button>

                        {onWatchTrailer && (
                            <button
                                type="button"
                                onClick={() => onWatchTrailer(mediaPayload)}
                                className="px-2.5 py-1 rounded-lg bg-[#22222C] hover:bg-[#2C2C38] text-[11px] font-semibold text-zinc-200 hover:text-white flex items-center gap-1 transition cursor-pointer"
                            >
                                <Play className="w-3 h-3 text-[#FF6B4A] fill-[#FF6B4A]" /> Trailer
                            </button>
                        )}

                        {user && onToggleWatchlist && (
                            <button
                                type="button"
                                disabled={togglingWatchlist}
                                onClick={() => onToggleWatchlist(log)}
                                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition cursor-pointer ${
                                    inViewerWatchlist
                                        ? 'bg-[#FF6B4A]/20 text-[#FF9F43] border border-[#FF6B4A]/40'
                                        : 'bg-[#22222C] hover:bg-[#2C2C38] text-zinc-300'
                                }`}
                            >
                                {inViewerWatchlist ? (
                                    <>
                                        <Bookmark className="w-3 h-3 fill-[#FF9F43]" /> In Watchlist
                                    </>
                                ) : (
                                    <>
                                        <Plus className="w-3 h-3" /> Watchlist
                                    </>
                                )}
                            </button>
                        )}

                        {onOpenMedia && (
                            <button
                                type="button"
                                onClick={() => onOpenMedia(mediaPayload)}
                                className="px-2.5 py-1 rounded-lg bg-[#22222C] hover:bg-[#2C2C38] text-[11px] font-semibold text-zinc-300 hover:text-white flex items-center gap-1 transition cursor-pointer"
                            >
                                <Edit3 className="w-3 h-3 text-[#FF9F43]" />
                                {isOwnLog ? 'Edit Log' : viewerLog ? 'Your Log' : 'Rate / Log'}
                            </button>
                        )}
                    </div>

                    {commentsOpen && (
                        <div className="mt-2 pt-2.5 border-t border-white/10 space-y-2">
                            {comments.map((c) => (
                                <div key={c.id} className="text-xs bg-[#14141A] rounded-xl px-3 py-2">
                                    <span className="font-bold text-white mr-1.5">
                                        @{c.profiles?.username ?? 'user'}
                                    </span>
                                    <span className="text-zinc-300">{c.comment_text}</span>
                                </div>
                            ))}

                            {user && (
                                <form onSubmit={handlePostReply} className="flex gap-2">
                                    <input
                                        type="text"
                                        placeholder="Reply to this log..."
                                        value={replyText}
                                        onChange={(e) => setReplyText(e.target.value)}
                                        className="flex-1 min-w-0 bg-[#22222C] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#FF6B4A]"
                                    />
                                    <button
                                        type="submit"
                                        disabled={postingReply || !replyText.trim()}
                                        className="px-3 py-1.5 rounded-xl bg-[#FF6B4A] hover:bg-[#FF9F43] text-white text-xs font-semibold disabled:opacity-40 cursor-pointer"
                                    >
                                        Reply
                                    </button>
                                </form>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </article>
    )
}