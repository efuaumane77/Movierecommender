import { useState, useEffect } from 'react'
import { X, Star, Play, Check, Tv, ListPlus, Award, Trash2, ChevronDown } from 'lucide-react'
import { posterUrl, getTrailerKey, getWatchProviders, type WatchProvidersSummary } from '../../lib/tmdb'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import type { CustomList, FavoritePin, MediaLog, MediaStatus } from '../../types/database'

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
    const { user, profile, setLocalTopFavorites, refreshProfile } = useAuth()
    const [status, setStatus] = useState<MediaStatus>('watchlist')
    const [rating, setRating] = useState<number>(0)
    const [reviewText, setReviewText] = useState('')
    const [season, setSeason] = useState(1)
    const [episode, setEpisode] = useState(1)
    const [trailerKey, setTrailerKey] = useState<string | null>(null)
    const [showTrailer, setShowTrailer] = useState(false)
    const [saving, setSaving] = useState(false)
    const [removingLog, setRemovingLog] = useState(false)

    const [providers, setProviders] = useState<WatchProvidersSummary | null>(null)
    const [lists, setLists] = useState<CustomList[]>([])
    const [selectedListId, setSelectedListId] = useState('')
    const [listStatusMsg, setListStatusMsg] = useState<string | null>(null)
    const [pinBusy, setPinBusy] = useState(false)

    useEffect(() => {
        if (!media) return
        setStatus(existingLog?.status ?? 'watchlist')
        setRating(existingLog?.rating ?? 0)
        setReviewText(existingLog?.review_text ?? '')
        setSeason(existingLog?.season ?? 1)
        setEpisode(existingLog?.episode ?? 1)
        setShowTrailer(false)
        setTrailerKey(null)
        setProviders(null)
        setListStatusMsg(null)
        setPinBusy(false)
        setRemovingLog(false)

        getTrailerKey(media.media_type, media.tmdb_id)
            .then(setTrailerKey)
            .catch(() => setTrailerKey(null))

        getWatchProviders(media.media_type, media.tmdb_id, 'CA')
            .then(setProviders)
            .catch(() => setProviders(null))

        if (user) {
            supabase
                .from('custom_lists')
                .select('*')
                .or(`owner_id.eq.${user.id},is_collaborative.eq.true`)
                .order('created_at', { ascending: false })
                .then(({ data }) => {
                    const rows = (data as CustomList[]) ?? []
                    setLists(rows)
                    if (rows.length > 0) setSelectedListId(rows[0].id)
                })
        }
    }, [media, existingLog, user])

    if (!media) return null

    const currentPins: FavoritePin[] = Array.isArray(profile?.top_favorites)
        ? [...profile.top_favorites]
        : []

    const isPinned = currentPins.some(
        (p) => p.tmdb_id === media.tmdb_id && p.media_type === media.media_type
    )

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

    async function handleRemoveFromProfile() {
        if (!user || !media || !existingLog || removingLog) return
        setRemovingLog(true)

        const { error } = await supabase
            .from('media_logs')
            .delete()
            .eq('id', existingLog.id)
            .eq('user_id', user.id)

        if (!error && isPinned) {
            const nextPins = currentPins.filter(
                (p) => !(p.tmdb_id === media.tmdb_id && p.media_type === media.media_type)
            )
            setLocalTopFavorites(nextPins)
            await supabase
                .from('profiles')
                .update({ top_favorites: nextPins })
                .eq('id', user.id)
            await refreshProfile()
        }

        setRemovingLog(false)
        if (!error) {
            onSaved()
            onClose()
        }
    }

    async function handleAddToList() {
        if (!user || !media || !selectedListId) return
        setListStatusMsg(null)

        const { error } = await supabase.from('custom_list_items').upsert(
            {
                list_id: selectedListId,
                added_by: user.id,
                tmdb_id: media.tmdb_id,
                media_type: media.media_type,
                title: media.title,
                poster_path: media.poster_path,
            },
            { onConflict: 'list_id,tmdb_id,media_type' }
        )

        if (error) {
            setListStatusMsg(error.message)
        } else {
            setListStatusMsg('Added to list!')
        }
    }

    async function handlePinToTopFour() {
        if (!user || !media || pinBusy) return
        setPinBusy(true)

        const nextPins: FavoritePin[] = [
            {
                tmdb_id: media.tmdb_id,
                media_type: media.media_type,
                title: media.title,
                poster_path: media.poster_path,
            },
            ...currentPins.filter(
                (p) => !(p.tmdb_id === media.tmdb_id && p.media_type === media.media_type)
            ),
        ].slice(0, 4)

        setLocalTopFavorites(nextPins)

        const { error } = await supabase
            .from('profiles')
            .update({ top_favorites: nextPins })
            .eq('id', user.id)

        setPinBusy(false)
        if (error) {
            setLocalTopFavorites(currentPins)
        } else {
            await refreshProfile()
        }
    }

    async function handleRemoveFromTopFour() {
        if (!user || !media || pinBusy) return
        setPinBusy(true)

        const nextPins: FavoritePin[] = currentPins.filter(
            (p) => !(p.tmdb_id === media.tmdb_id && p.media_type === media.media_type)
        )

        setLocalTopFavorites(nextPins)

        const { error } = await supabase
            .from('profiles')
            .update({ top_favorites: nextPins })
            .eq('id', user.id)

        setPinBusy(false)
        if (error) {
            setLocalTopFavorites(currentPins)
        } else {
            await refreshProfile()
        }
    }

    const cleanFlatrate = (providers?.flatrate ?? []).filter(
        (p) => !/with ads|amazon channel|apple tv channel/i.test(p.provider_name)
    )

    return (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-lg max-h-[90dvh] overflow-y-auto bg-[#18181F] border border-white/15 rounded-2xl shadow-2xl">
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

                        <div className="mt-2.5 flex items-center gap-3 flex-wrap">
                            {trailerKey && (
                                <button
                                    type="button"
                                    onClick={() => setShowTrailer(!showTrailer)}
                                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#FF6B4A] hover:text-[#FF9F43] cursor-pointer"
                                >
                                    <Play className="w-3.5 h-3.5 fill-current" />
                                    {showTrailer ? 'Hide Trailer' : 'Watch Trailer'}
                                </button>
                            )}

                            {user && !isPinned && (
                                <button
                                    type="button"
                                    disabled={pinBusy}
                                    onClick={handlePinToTopFour}
                                    className="inline-flex items-center gap-1 text-xs font-semibold text-amber-400 hover:text-amber-300 cursor-pointer disabled:opacity-50"
                                >
                                    <Award className="w-3.5 h-3.5" />
                                    Pin to Top 4
                                </button>
                            )}

                            {user && isPinned && (
                                <button
                                    type="button"
                                    disabled={pinBusy}
                                    onClick={handleRemoveFromTopFour}
                                    className="inline-flex items-center gap-1 text-xs font-semibold text-red-400 hover:text-red-300 cursor-pointer disabled:opacity-50"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    Remove from Top 4
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {cleanFlatrate.length > 0 && (
                    <div className="px-5 py-2.5 bg-[#14141A] border-b border-white/10 flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1.5">
                            <Tv className="w-3.5 h-3.5 text-[#FF9F43]" /> Stream on:
                        </span>
                        <div className="flex items-center gap-1.5 flex-wrap">
                            {cleanFlatrate.map((p) => (
                                <span
                                    key={p.provider_id}
                                    title={p.provider_name}
                                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-[#22222C] border border-white/10 text-[10px] font-semibold text-zinc-200"
                                >
                                    <img
                                        src={`https://image.tmdb.org/t/p/w45${p.logo_path}`}
                                        alt={p.provider_name}
                                        className="w-3.5 h-3.5 rounded-xs object-cover"
                                    />
                                    {p.provider_name}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

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

                <form onSubmit={handleSave} className="p-5 space-y-4">
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

                    {user && lists.length > 0 && (
                        <div className="pt-2 border-t border-white/10 flex items-center gap-2">
                            <div className="relative flex-1 min-w-0">
                                <select
                                    value={selectedListId}
                                    onChange={(e) => setSelectedListId(e.target.value)}
                                    className="w-full appearance-none bg-[#22222C] border border-white/10 rounded-xl pl-3 pr-8 py-2 text-xs text-white focus:outline-none focus:border-[#FF6B4A]"
                                >
                                    {lists.map((l) => (
                                        <option key={l.id} value={l.id}>
                                            {l.title} {l.is_collaborative ? '(Shared)' : ''}
                                        </option>
                                    ))}
                                </select>
                                <ChevronDown className="w-3.5 h-3.5 text-zinc-400 pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" />
                            </div>
                            <button
                                type="button"
                                onClick={handleAddToList}
                                className="px-3 py-2 rounded-xl bg-[#22222C] hover:bg-[#2C2C38] border border-white/15 text-xs font-semibold text-[#FF9F43] flex items-center gap-1 cursor-pointer shrink-0"
                            >
                                <ListPlus className="w-3.5 h-3.5" />
                                {listStatusMsg ?? 'Add to List'}
                            </button>
                        </div>
                    )}

                    <div className="flex items-center gap-2.5 pt-1">
                        {existingLog && (
                            <button
                                type="button"
                                disabled={removingLog || saving}
                                onClick={handleRemoveFromProfile}
                                className="px-3.5 py-2.5 rounded-xl font-semibold text-xs text-red-400 hover:text-white bg-red-500/10 hover:bg-red-500/80 border border-red-500/30 transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                                {removingLog ? 'Removing...' : 'Remove'}
                            </button>
                        )}

                        <button
                            type="submit"
                            disabled={saving || removingLog}
                            className="flex-1 py-2.5 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-[#FF6B4A] to-[#FF9F43] hover:opacity-95 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                        >
                            <Check className="w-4 h-4" />
                            {saving ? 'Saving...' : 'Save to Cinerate'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}