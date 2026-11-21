import { useState, useEffect } from 'react'
import { X, Star, Play, Check } from 'lucide-react'
import { posterUrl, getTrailerKey } from '../../lib/tmdb'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import type { MediaLog, MediaStatus } from '../../types/database'

export interface SelectedMedia {
    tmdb_id: number
    media_type: 'movie' | 'tv'
    title: string
    poster_path: string | null
    overview?: string
}

interface MediaModalProps {
    media: SelectedMedia | null
    existingLog?: MediaLog
    onClose: () => void
    onSaved: () => void
}

export function MediaModal({ media, existingLog, onClose, onSaved }: MediaModalProps) {
    const { user } = useAuth()
    const [status, setStatus] = useState<MediaStatus>('watchlist')
    const [rating, setRating] = useState<number>(0)
    const [reviewText, setReviewText] = useState('')
    const [season, setSeason] = useState(1)
    const [episode, setEpisode] = useState(1)
    const [trailerKey, setTrailerKey] = useState<string | null>(null)
    const [showTrailer, setShowTrailer] = useState(false)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        if (!media) return
        setStatus(existingLog?.status ?? 'watchlist')
        setRating(existingLog?.rating ?? 0)
        setReviewText(existingLog?.review_text ?? '')
        setSeason(existingLog?.season ?? 1)
        setEpisode(existingLog?.episode ?? 1)
        setShowTrailer(false)
        setTrailerKey(null)

        getTrailerKey(media.media_type, media.tmdb_id)
            .then(setTrailerKey)
            .catch(() => setTrailerKey(null))
    }, [media, existingLog])

    if (!media) return null

    async function handleSave(e: React.FormEvent) {
        e.preventDefault()
        if (!user || !media) return
        setSaving(true)

        const { error } = await supabase.from('media_logs').upsert(
            {
                user_id: user.id,
                tmdb_id: media.tmdb_id,
                media_type: media.media_type,
                title: media.title,
                poster_path: media.poster_path,
                status,
                rating: rating > 0 ? rating : null,
                review_text: reviewText.trim() || null,
                season: media.media_type === 'tv' ? season : 1,
                episode: media.media_type === 'tv' ? episode : 0,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,tmdb_id,media_type' }
        )

        setSaving(false)
        if (!error) {
            onSaved()
            onClose()
        }
    }

    return (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-lg bg-[#18181F] border border-white/15 rounded-2xl overflow-hidden shadow-2xl">
                {/* Header */}
                <div className="flex items-start gap-4 p-5 border-b border-white/10">
                    {media.poster_path ? (
                        <img
                            src={posterUrl(media.poster_path, 'w185')}
                            alt={media.title}
                            className="w-20 h-28 rounded-xl object-cover shrink-0"
                        />
                    ) : (
                        <div className="w-20 h-28 rounded-xl bg-[#22222C] shrink-0" />
                    )}

                    <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                            <h2 className="text-lg font-bold text-white leading-tight">{media.title}</h2>
                            <button onClick={onClose} className="text-zinc-400 hover:text-white cursor-pointer">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <p className="text-xs text-zinc-400 mt-1 uppercase tracking-wider">
                            {media.media_type === 'tv' ? 'TV Series' : 'Movie'}
                        </p>
                        {media.overview && (
                            <p className="text-xs text-zinc-400 mt-2 line-clamp-2">{media.overview}</p>
                        )}

                        {trailerKey && (
                            <button
                                type="button"
                                onClick={() => setShowTrailer(!showTrailer)}
                                className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-[#FF6B4A] hover:text-[#FF9F43] cursor-pointer"
                            >
                                <Play className="w-3.5 h-3.5 fill-current" />
                                {showTrailer ? 'Hide Trailer' : 'Watch Trailer'}
                            </button>
                        )}
                    </div>
                </div>

                {/* Embedded Trailer */}
                {showTrailer && trailerKey && (
                    <div className="aspect-video w-full bg-black">
                        <iframe
                            className="w-full h-full"
                            src={`https://www.youtube.com/embed/${trailerKey}?autoplay=1`}
                            title={media.title}
                            allow="autoplay; encrypted-media"
                            allowFullScreen
                        />
                    </div>
                )}

                {/* Log Form */}
                <form onSubmit={handleSave} className="p-5 space-y-4">
                    {/* Status Selector */}
                    <div>
                        <label className="block text-xs text-zinc-400 mb-1.5">Shelf Status</label>
                        <div className="grid grid-cols-3 gap-2">
                            {(['watchlist', 'watching', 'watched'] as MediaStatus[]).map((s) => (
                                <button
                                    key={s}
                                    type="button"
                                    onClick={() => setStatus(s)}
                                    className={`py-2 rounded-xl text-xs font-semibold capitalize border transition cursor-pointer ${
                                        status === s
                                            ? 'bg-[#FF6B4A] border-[#FF6B4A] text-white'
                                            : 'bg-[#22222C] border-white/10 text-zinc-300 hover:border-white/25'
                                    }`}
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Season & Episode Progress (TV Shows) */}
                    {media.media_type === 'tv' && (
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs text-zinc-400 mb-1">Season</label>
                                <input
                                    type="number"
                                    min={1}
                                    value={season}
                                    onChange={(e) => setSeason(Math.max(1, Number(e.target.value)))}
                                    className="w-full bg-[#22222C] border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-zinc-400 mb-1">Episode (Spoiler Gate)</label>
                                <input
                                    type="number"
                                    min={0}
                                    value={episode}
                                    onChange={(e) => setEpisode(Math.max(0, Number(e.target.value)))}
                                    className="w-full bg-[#22222C] border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
                                />
                            </div>
                        </div>
                    )}

                    {/* Star Rating (1-5) */}
                    <div>
                        <label className="block text-xs text-zinc-400 mb-1.5">Your Rating</label>
                        <div className="flex items-center gap-1.5">
                            {[1, 2, 3, 4, 5].map((star) => (
                                <button
                                    key={star}
                                    type="button"
                                    onClick={() => setRating(rating === star ? 0 : star)}
                                    className="p-1 cursor-pointer"
                                >
                                    <Star
                                        className={`w-6 h-6 transition ${
                                            star <= rating ? 'text-[#FF9F43] fill-[#FF9F43]' : 'text-zinc-600'
                                        }`}
                                    />
                                </button>
                            ))}
                            {rating > 0 && <span className="text-xs text-zinc-400 ml-2">{rating}/5</span>}
                        </div>
                    </div>

                    {/* Review / Reaction Note */}
                    <div>
                        <label className="block text-xs text-zinc-400 mb-1">
                            Thoughts / Reaction {media.media_type === 'tv' && '(Auto-blurred for friends behind your episode)'}
                        </label>
                        <textarea
                            rows={3}
                            placeholder="Write a quick review or episode reaction..."
                            value={reviewText}
                            onChange={(e) => setReviewText(e.target.value)}
                            className="w-full bg-[#22222C] border border-white/10 rounded-xl p-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#FF6B4A]"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={saving}
                        className="w-full py-2.5 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-[#FF6B4A] to-[#FF9F43] hover:opacity-95 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                        <Check className="w-4 h-4" />
                        {saving ? 'Saving...' : 'Save to Cinerate'}
                    </button>
                </form>
            </div>
        </div>
    )
}