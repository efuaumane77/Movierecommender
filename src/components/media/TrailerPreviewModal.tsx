import { useEffect, useState } from 'react'
import { X, Plus, Film } from 'lucide-react'
import { getTrailerKey, posterUrl } from '../../lib/tmdb'
import type { SelectedMedia } from './MediaModal'

interface TrailerPreviewModalProps {
    media: SelectedMedia | null
    onClose: () => void
    onOpenLogModal: (media: SelectedMedia) => void
}

export function TrailerPreviewModal({
                                        media,
                                        onClose,
                                        onOpenLogModal,
                                    }: TrailerPreviewModalProps) {
    const [trailerKey, setTrailerKey] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        if (!media) {
            setTrailerKey(null)
            return
        }

        let cancelled = false
        setLoading(true)
        setTrailerKey(null)

        getTrailerKey(media.media_type, media.tmdb_id)
            .then((key) => {
                if (!cancelled) setTrailerKey(key)
            })
            .catch(() => {
                if (!cancelled) setTrailerKey(null)
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })

        return () => {
            cancelled = true
        }
    }, [media])

    useEffect(() => {
        if (!media) return
        function onKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [media, onClose])

    if (!media) return null

    return (
        <div
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
            <div
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-2xl bg-[#18181F] border border-white/15 rounded-2xl overflow-hidden shadow-2xl"
            >
                {/* Header */}
                <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        {media.poster_path ? (
                            <img
                                src={posterUrl(media.poster_path, 'w185')}
                                alt={media.title}
                                className="w-9 h-12 rounded-lg object-cover shrink-0"
                            />
                        ) : (
                            <div className="w-9 h-12 rounded-lg bg-[#22222C] flex items-center justify-center shrink-0">
                                <Film className="w-4 h-4 text-zinc-400" />
                            </div>
                        )}
                        <div className="min-w-0">
                            <h2 className="text-sm font-bold text-white truncate">{media.title}</h2>
                            <p className="text-[11px] text-zinc-400 uppercase tracking-wider">
                                {media.media_type === 'tv' ? 'TV Series' : 'Movie'} • Official Trailer
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            type="button"
                            onClick={() => {
                                const target = media
                                onClose()
                                onOpenLogModal(target)
                            }}
                            className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-[#FF6B4A] to-[#FF9F43] text-white text-xs font-semibold flex items-center gap-1 hover:opacity-95 transition cursor-pointer"
                        >
                            <Plus className="w-3.5 h-3.5" /> Log / Review
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Close trailer modal"
                            className="p-1.5 rounded-xl bg-[#22222C] text-zinc-300 hover:text-white transition cursor-pointer"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Trailer Player */}
                <div className="aspect-video w-full bg-black flex items-center justify-center">
                    {loading ? (
                        <p className="text-xs text-zinc-400">Loading trailer...</p>
                    ) : trailerKey ? (
                        <iframe
                            className="w-full h-full"
                            src={`https://www.youtube-nocookie.com/embed/${trailerKey}?autoplay=1&rel=0&playsinline=1`}
                            title={`${media.title} Trailer`}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                        />
                    ) : (
                        <div className="p-6 text-center space-y-2">
                            <p className="text-xs text-zinc-300">No trailer available for {media.title} on TMDB.</p>
                            {media.overview && (
                                <p className="text-xs text-zinc-500 max-w-md mx-auto leading-relaxed">
                                    {media.overview}
                                </p>
                            )}
                        </div>
                    )}
                </div>

                {/* Synopsis */}
                {media.overview && (
                    <div className="px-4 py-3 border-t border-white/5">
                        <p className="text-xs text-zinc-300 leading-relaxed">{media.overview}</p>
                    </div>
                )}
            </div>
        </div>
    )
}