import { useState, useEffect } from 'react'
import {
    X,
    Play,
    Check,
    Tv,
    ListPlus,
    Award,
    Trash2,
    ChevronDown,
    FolderPlus,
    UserPlus,
    UserCheck,
    Sparkles,
    Users,
} from 'lucide-react'
import {
    posterUrl,
    getTrailerKey,
    getWatchProviders,
    getMediaCredits,
    getPersonFilmography,
    getSimilarRecommendations,
    type WatchProvidersSummary,
    type TMDBPersonCredit,
    type TMDBSearchResult,
} from '../../lib/tmdb'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { StarRatingInput } from './StarRatingInput'
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
    const [activeMedia, setActiveMedia] = useState<SelectedMedia | null>(media)
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
    const [creatingNewLibrary, setCreatingNewLibrary] = useState(false)
    const [newLibraryTitle, setNewLibraryTitle] = useState('')
    const [savingLibrary, setSavingLibrary] = useState(false)
    const [pinBusy, setPinBusy] = useState(false)

    // Cast, Crew, Followed People & Similar Titles
    const [credits, setCredits] = useState<TMDBPersonCredit[]>([])
    const [showFullCast, setShowFullCast] = useState(false)
    const [followedPersonIds, setFollowedPersonIds] = useState<Set<number>>(new Set())
    const [selectedPerson, setSelectedPerson] = useState<TMDBPersonCredit | null>(null)
    const [personCredits, setPersonCredits] = useState<TMDBSearchResult[]>([])
    const [loadingPerson, setLoadingPerson] = useState(false)
    const [togglingPersonId, setTogglingPersonId] = useState<number | null>(null)
    const [similarItems, setSimilarItems] = useState<TMDBSearchResult[]>([])

    useEffect(() => {
        setActiveMedia(media)
    }, [media])

    useEffect(() => {
        if (!activeMedia) return
        const isSameAsInitial =
            media &&
            activeMedia.tmdb_id === media.tmdb_id &&
            activeMedia.media_type === media.media_type

        setStatus(isSameAsInitial && existingLog ? existingLog.status : 'watchlist')
        setRating(isSameAsInitial && existingLog?.rating ? existingLog.rating : 0)
        setReviewText(isSameAsInitial && existingLog?.review_text ? existingLog.review_text : '')
        setSeason(isSameAsInitial && existingLog?.season ? existingLog.season : 1)
        setEpisode(isSameAsInitial && existingLog?.episode ? existingLog.episode : 1)

        setShowTrailer(false)
        setTrailerKey(null)
        setProviders(null)
        setListStatusMsg(null)
        setCreatingNewLibrary(false)
        setNewLibraryTitle('')
        setSavingLibrary(false)
        setPinBusy(false)
        setRemovingLog(false)

        setCredits([])
        setShowFullCast(false)
        setSelectedPerson(null)
        setPersonCredits([])
        setSimilarItems([])

        getTrailerKey(activeMedia.media_type, activeMedia.tmdb_id)
            .then(setTrailerKey)
            .catch(() => setTrailerKey(null))

        getWatchProviders(activeMedia.media_type, activeMedia.tmdb_id, 'CA')
            .then(setProviders)
            .catch(() => setProviders(null))

        getMediaCredits(activeMedia.media_type, activeMedia.tmdb_id)
            .then(setCredits)
            .catch(() => setCredits([]))

        getSimilarRecommendations(activeMedia.media_type, activeMedia.tmdb_id)
            .then(setSimilarItems)
            .catch(() => setSimilarItems([]))

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
                    else setCreatingNewLibrary(true)
                })

            supabase
                .from('followed_people')
                .select('person_id')
                .eq('user_id', user.id)
                .then(({ data }) => {
                    const ids = new Set<number>(
                        ((data as { person_id: number }[]) ?? []).map((r) => Number(r.person_id))
                    )
                    setFollowedPersonIds(ids)
                })
        }
    }, [activeMedia, existingLog, media, user])

    if (!activeMedia) return null

    const isInitialMedia = Boolean(
        media &&
        activeMedia.tmdb_id === media.tmdb_id &&
        activeMedia.media_type === media.media_type
    )
    const activeExistingLog = isInitialMedia ? existingLog : undefined

    const currentPins: FavoritePin[] = Array.isArray(profile?.top_favorites)
        ? [...profile.top_favorites]
        : []

    const isPinned = currentPins.some(
        (p) => p.tmdb_id === activeMedia.tmdb_id && p.media_type === activeMedia.media_type
    )

    async function handleInspectPerson(person: TMDBPersonCredit) {
        if (selectedPerson?.id === person.id) {
            setSelectedPerson(null)
            setPersonCredits([])
            return
        }
        setSelectedPerson(person)
        setLoadingPerson(true)
        setPersonCredits([])
        try {
            const works = await getPersonFilmography(person.id)
            setPersonCredits(works)
        } catch {
            setPersonCredits([])
        } finally {
            setLoadingPerson(false)
        }
    }

    async function handleToggleFollowPerson(person: TMDBPersonCredit) {
        if (!user || togglingPersonId === person.id) return
        setTogglingPersonId(person.id)
        const alreadyFollowing = followedPersonIds.has(person.id)

        setFollowedPersonIds((prev) => {
            const next = new Set(prev)
            if (alreadyFollowing) next.delete(person.id)
            else next.add(person.id)
            return next
        })

        if (alreadyFollowing) {
            const { error } = await supabase
                .from('followed_people')
                .delete()
                .eq('user_id', user.id)
                .eq('person_id', person.id)

            if (error) {
                setFollowedPersonIds((prev) => new Set(prev).add(person.id))
            }
        } else {
            const { error } = await supabase.from('followed_people').insert({
                user_id: user.id,
                person_id: person.id,
                name: person.name,
                role: person.role,
                profile_path: person.profile_path,
            })

            if (error) {
                setFollowedPersonIds((prev) => {
                    const next = new Set(prev)
                    next.delete(person.id)
                    return next
                })
            }
        }

        setTogglingPersonId(null)
    }

    function handleJumpToMedia(item: TMDBSearchResult) {
        const title = item.title || item.name || 'Untitled'
        setActiveMedia({
            tmdb_id: item.id,
            media_type: item.media_type,
            title,
            poster_path: item.poster_path,
            overview: item.overview,
        })
    }

    async function handleSave(e: React.FormEvent) {
        e.preventDefault()
        if (!user || !activeMedia) return
        setSaving(true)

        const { error } = await supabase.from('media_logs').upsert(
            {
                user_id: user.id,
                tmdb_id: activeMedia.tmdb_id,
                media_type: activeMedia.media_type,
                title: activeMedia.title,
                poster_path: activeMedia.poster_path,
                status,
                rating: rating > 0 ? rating : null,
                review_text: reviewText.trim() || null,
                season: activeMedia.media_type === 'tv' ? season : 1,
                episode: activeMedia.media_type === 'tv' ? episode : 0,
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
        if (!user || !activeMedia || !activeExistingLog || removingLog) return
        setRemovingLog(true)

        const { error } = await supabase
            .from('media_logs')
            .delete()
            .eq('id', activeExistingLog.id)
            .eq('user_id', user.id)

        if (!error && isPinned) {
            const nextPins = currentPins.filter(
                (p) =>
                    !(
                        p.tmdb_id === activeMedia.tmdb_id &&
                        p.media_type === activeMedia.media_type
                    )
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

    async function handleAddToLibrary() {
        if (!user || !activeMedia || !selectedListId) return
        setListStatusMsg(null)

        const { error } = await supabase.from('custom_list_items').upsert(
            {
                list_id: selectedListId,
                added_by: user.id,
                tmdb_id: activeMedia.tmdb_id,
                media_type: activeMedia.media_type,
                title: activeMedia.title,
                poster_path: activeMedia.poster_path,
            },
            { onConflict: 'list_id,tmdb_id,media_type' }
        )

        if (error) {
            setListStatusMsg(error.message)
        } else {
            setListStatusMsg('Added to library!')
        }
    }

    async function handleCreateLibraryAndAdd() {
        if (!user || !activeMedia || !newLibraryTitle.trim() || savingLibrary) return
        setSavingLibrary(true)
        setListStatusMsg(null)

        const { data: createdList, error: listError } = await supabase
            .from('custom_lists')
            .insert({
                owner_id: user.id,
                title: newLibraryTitle.trim(),
                is_collaborative: true,
            })
            .select('*')
            .single()

        if (listError || !createdList) {
            setSavingLibrary(false)
            setListStatusMsg(listError?.message ?? 'Could not create library')
            return
        }

        const typedList = createdList as CustomList
        const { error: itemError } = await supabase.from('custom_list_items').upsert(
            {
                list_id: typedList.id,
                added_by: user.id,
                tmdb_id: activeMedia.tmdb_id,
                media_type: activeMedia.media_type,
                title: activeMedia.title,
                poster_path: activeMedia.poster_path,
            },
            { onConflict: 'list_id,tmdb_id,media_type' }
        )

        setSavingLibrary(false)
        setLists((prev) => [typedList, ...prev])
        setSelectedListId(typedList.id)
        setNewLibraryTitle('')
        setCreatingNewLibrary(false)

        if (itemError) {
            setListStatusMsg(itemError.message)
        } else {
            setListStatusMsg(`Created & added to ${typedList.title}!`)
        }
    }

    async function handlePinToTopFour() {
        if (!user || !activeMedia || pinBusy) return
        setPinBusy(true)

        const nextPins: FavoritePin[] = [
            {
                tmdb_id: activeMedia.tmdb_id,
                media_type: activeMedia.media_type,
                title: activeMedia.title,
                poster_path: activeMedia.poster_path,
            },
            ...currentPins.filter(
                (p) =>
                    !(
                        p.tmdb_id === activeMedia.tmdb_id &&
                        p.media_type === activeMedia.media_type
                    )
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
        if (!user || !activeMedia || pinBusy) return
        setPinBusy(true)

        const nextPins: FavoritePin[] = currentPins.filter(
            (p) =>
                !(
                    p.tmdb_id === activeMedia.tmdb_id &&
                    p.media_type === activeMedia.media_type
                )
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
            <div className="w-full max-w-lg max-h-[90dvh] overflow-y-auto no-scrollbar bg-[#18181F] border border-white/15 rounded-2xl shadow-2xl">
                {/* Header */}
                <div className="flex items-start gap-4 p-5 border-b border-white/10">
                    {activeMedia.poster_path ? (
                        <img
                            src={posterUrl(activeMedia.poster_path, 'w185')}
                            alt={activeMedia.title}
                            className="w-20 h-28 rounded-xl object-cover shrink-0"
                        />
                    ) : (
                        <div className="w-20 h-28 rounded-xl bg-[#22222C] shrink-0" />
                    )}

                    <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                            <h2 className="text-lg font-bold text-white leading-tight">
                                {activeMedia.title}
                            </h2>
                            <button
                                onClick={onClose}
                                className="text-zinc-400 hover:text-white cursor-pointer"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <p className="text-xs text-zinc-400 mt-1 uppercase tracking-wider">
                            {activeMedia.media_type === 'tv' ? 'TV Series' : 'Movie'}
                        </p>
                        {activeMedia.overview && (
                            <p className="text-xs text-zinc-400 mt-2 line-clamp-2">
                                {activeMedia.overview}
                            </p>
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

                {/* Streaming Providers */}
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

                {/* Embedded Trailer */}
                {showTrailer && trailerKey && (
                    <div className="aspect-video w-full bg-black">
                        <iframe
                            className="w-full h-full"
                            src={`https://www.youtube.com/embed/${trailerKey}?autoplay=1`}
                            title={activeMedia.title}
                            allow="autoplay; encrypted-media"
                            allowFullScreen
                        />
                    </div>
                )}

                {/* Director & Cast Strip + Full Cast Dropdown + Inline Filmography Drawer */}
                {credits.length > 0 && (
                    <div className="px-5 py-3 bg-[#14141A] border-b border-white/10 space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1.5">
                                <Users className="w-3.5 h-3.5 text-[#FF6B4A]" /> Director &amp; Cast
                            </span>

                            {credits.length > 6 && (
                                <button
                                    type="button"
                                    onClick={() => setShowFullCast((prev) => !prev)}
                                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#FF9F43] hover:text-[#FF6B4A] transition cursor-pointer"
                                >
                                    {showFullCast ? 'Show Less' : `Full Cast (${credits.length})`}
                                    <ChevronDown
                                        className={`w-3.5 h-3.5 transition-transform ${
                                            showFullCast ? 'rotate-180' : ''
                                        }`}
                                    />
                                </button>
                            )}
                        </div>

                        {showFullCast ? (
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-56 overflow-y-auto no-scrollbar pr-0.5">
                                {credits.map((person) => {
                                    const isFollowing = followedPersonIds.has(person.id)
                                    const isSelected = selectedPerson?.id === person.id

                                    return (
                                        <button
                                            key={`${person.role}-${person.id}`}
                                            type="button"
                                            onClick={() => handleInspectPerson(person)}
                                            className={`flex items-center gap-2 p-2 rounded-xl border text-left transition cursor-pointer ${
                                                isSelected
                                                    ? 'bg-[#FF6B4A]/20 border-[#FF6B4A] text-white'
                                                    : 'bg-[#22222C] hover:bg-[#2C2C38] border-white/10 text-zinc-200'
                                            }`}
                                        >
                                            {person.profile_path ? (
                                                <img
                                                    src={posterUrl(person.profile_path, 'w185')}
                                                    alt={person.name}
                                                    className="w-7 h-7 rounded-full object-cover shrink-0"
                                                />
                                            ) : (
                                                <div className="w-7 h-7 rounded-full bg-[#18181F] flex items-center justify-center text-[10px] font-bold text-zinc-400 shrink-0">
                                                    {person.name[0]}
                                                </div>
                                            )}

                                            <div className="min-w-0 flex-1">
                                                <p className="text-[11px] font-semibold leading-tight truncate">
                                                    {person.name}
                                                </p>
                                                <p className="text-[9px] text-zinc-400 leading-tight truncate">
                                                    {person.role === 'Director'
                                                        ? 'Director'
                                                        : person.character || 'Actor'}
                                                    {isFollowing ? ' • Following' : ''}
                                                </p>
                                            </div>
                                        </button>
                                    )
                                })}
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
                                {credits.slice(0, 6).map((person) => {
                                    const isFollowing = followedPersonIds.has(person.id)
                                    const isSelected = selectedPerson?.id === person.id

                                    return (
                                        <button
                                            key={`${person.role}-${person.id}`}
                                            type="button"
                                            onClick={() => handleInspectPerson(person)}
                                            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl border text-left shrink-0 transition cursor-pointer ${
                                                isSelected
                                                    ? 'bg-[#FF6B4A]/20 border-[#FF6B4A] text-white'
                                                    : 'bg-[#22222C] hover:bg-[#2C2C38] border-white/10 text-zinc-200'
                                            }`}
                                        >
                                            {person.profile_path ? (
                                                <img
                                                    src={posterUrl(person.profile_path, 'w185')}
                                                    alt={person.name}
                                                    className="w-6 h-6 rounded-full object-cover shrink-0"
                                                />
                                            ) : (
                                                <div className="w-6 h-6 rounded-full bg-[#18181F] flex items-center justify-center text-[10px] font-bold text-zinc-400 shrink-0">
                                                    {person.name[0]}
                                                </div>
                                            )}

                                            <div className="min-w-0">
                                                <p className="text-[11px] font-semibold leading-tight truncate max-w-[110px]">
                                                    {person.name}
                                                </p>
                                                <p className="text-[9px] text-zinc-400 leading-tight">
                                                    {person.role}
                                                    {isFollowing ? ' • Following' : ''}
                                                </p>
                                            </div>
                                        </button>
                                    )
                                })}
                            </div>
                        )}

                        {/* Expanded Filmography Drawer for Selected Actor/Director */}
                        {selectedPerson && (
                            <div className="bg-[#18181F] border border-white/10 rounded-xl p-3 space-y-2.5">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="text-xs font-bold text-white truncate">
                                            {selectedPerson.name}
                                        </p>
                                        <p className="text-[10px] text-zinc-400">
                                            {selectedPerson.role === 'Director'
                                                ? 'Director'
                                                : selectedPerson.character
                                                    ? `as ${selectedPerson.character}`
                                                    : 'Actor'}{' '}
                                            • Known for
                                        </p>
                                    </div>

                                    <div className="flex items-center gap-1.5 shrink-0">
                                        {user && (
                                            <button
                                                type="button"
                                                disabled={togglingPersonId === selectedPerson.id}
                                                onClick={() => handleToggleFollowPerson(selectedPerson)}
                                                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold inline-flex items-center gap-1 transition cursor-pointer ${
                                                    followedPersonIds.has(selectedPerson.id)
                                                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                                        : 'bg-[#FF6B4A] hover:bg-[#FF9F43] text-white'
                                                }`}
                                            >
                                                {followedPersonIds.has(selectedPerson.id) ? (
                                                    <>
                                                        <UserCheck className="w-3 h-3" /> Following
                                                    </>
                                                ) : (
                                                    <>
                                                        <UserPlus className="w-3 h-3" /> Follow
                                                    </>
                                                )}
                                            </button>
                                        )}

                                        <button
                                            type="button"
                                            onClick={() => setSelectedPerson(null)}
                                            className="p-1 text-zinc-400 hover:text-white cursor-pointer"
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>

                                {loadingPerson ? (
                                    <p className="text-[11px] text-zinc-400 py-2">
                                        Loading filmography...
                                    </p>
                                ) : personCredits.length === 0 ? (
                                    <p className="text-[11px] text-zinc-500">No titles found.</p>
                                ) : (
                                    <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
                                        {personCredits.map((work) => {
                                            const workTitle = work.title || work.name || 'Untitled'
                                            return (
                                                <button
                                                    key={`${work.media_type}-${work.id}`}
                                                    type="button"
                                                    onClick={() => handleJumpToMedia(work)}
                                                    className="w-20 shrink-0 text-left group cursor-pointer"
                                                >
                                                    {work.poster_path ? (
                                                        <img
                                                            src={posterUrl(work.poster_path, 'w185')}
                                                            alt={workTitle}
                                                            className="w-full aspect-[2/3] rounded-lg object-cover border border-white/10 group-hover:border-[#FF6B4A] transition"
                                                        />
                                                    ) : (
                                                        <div className="w-full aspect-[2/3] rounded-lg bg-[#22222C]" />
                                                    )}
                                                    <p className="text-[10px] font-semibold text-zinc-200 group-hover:text-[#FF9F43] truncate mt-1">
                                                        {workTitle}
                                                    </p>
                                                </button>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Logging & Rating Form */}
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

                    {activeMedia.media_type === 'tv' && (
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
                                <label className="block text-xs text-zinc-400 mb-1">
                                    Episode (Spoiler Gate)
                                </label>
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
                        <StarRatingInput
                            value={rating}
                            onChange={(next) => {
                                setRating(next)
                                if (next > 0 && status === 'watchlist') setStatus('watched')
                            }}
                        />
                    </div>

                    <div>
                        <label className="block text-xs text-zinc-400 mb-1">
                            Thoughts / Reaction{' '}
                            {activeMedia.media_type === 'tv' &&
                                '(Auto-blurred for friends behind your episode)'}
                        </label>
                        <textarea
                            rows={3}
                            placeholder="Write a quick review or episode reaction..."
                            value={reviewText}
                            onChange={(e) => {
                                const val = e.target.value
                                setReviewText(val)
                                if (val.trim().length > 0 && status === 'watchlist') {
                                    setStatus('watched')
                                }
                            }}
                            className="w-full bg-[#22222C] border border-white/10 rounded-xl p-3 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#FF6B4A]"
                        />
                    </div>

                    {user && (
                        <div className="pt-2 border-t border-white/10 space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-zinc-400">Library</span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setListStatusMsg(null)
                                        setCreatingNewLibrary((v) => !v)
                                    }}
                                    className="text-[11px] font-semibold text-[#FF9F43] hover:text-[#FF6B4A] inline-flex items-center gap-1 cursor-pointer"
                                >
                                    <FolderPlus className="w-3 h-3" />
                                    {creatingNewLibrary ? 'Select Existing' : '+ New Library'}
                                </button>
                            </div>

                            {creatingNewLibrary || lists.length === 0 ? (
                                <div className="flex items-center gap-2">
                                    <input
                                        type="text"
                                        placeholder="New library name..."
                                        value={newLibraryTitle}
                                        onChange={(e) => setNewLibraryTitle(e.target.value)}
                                        className="flex-1 min-w-0 bg-[#22222C] border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#FF6B4A]"
                                    />
                                    <button
                                        type="button"
                                        disabled={savingLibrary || !newLibraryTitle.trim()}
                                        onClick={handleCreateLibraryAndAdd}
                                        className="px-3 py-2 rounded-xl bg-[#22222C] hover:bg-[#2C2C38] border border-white/15 text-xs font-semibold text-[#FF9F43] flex items-center gap-1 cursor-pointer disabled:opacity-40 shrink-0"
                                    >
                                        <ListPlus className="w-3.5 h-3.5" />
                                        {savingLibrary ? 'Creating...' : 'Create & Add'}
                                    </button>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2">
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
                                        <ChevronDown className="w-3.5 h-3.5 text-zinc-400 pointer-events-none right-2.5 top-1/2 -translate-y-1/2 absolute" />
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleAddToLibrary}
                                        className="px-3 py-2 rounded-xl bg-[#22222C] hover:bg-[#2C2C38] border border-white/15 text-xs font-semibold text-[#FF9F43] flex items-center gap-1 cursor-pointer shrink-0"
                                    >
                                        <ListPlus className="w-3.5 h-3.5" />
                                        {listStatusMsg ?? 'Add to Library'}
                                    </button>
                                </div>
                            )}

                            {listStatusMsg && !creatingNewLibrary && lists.length > 0 && (
                                <p className="text-[11px] text-emerald-400">{listStatusMsg}</p>
                            )}
                        </div>
                    )}

                    <div className="flex items-center gap-2.5 pt-1">
                        {activeExistingLog && (
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

                {/* More Like This Strip */}
                {similarItems.length > 0 && (
                    <div className="px-5 py-4 bg-[#14141A] border-t border-white/10 space-y-2.5">
                        <span className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1.5">
                            <Sparkles className="w-3.5 h-3.5 text-[#FF9F43]" /> More Like This
                        </span>

                        <div className="flex gap-2.5 overflow-x-auto no-scrollbar pb-1">
                            {similarItems.map((sim) => {
                                const simTitle = sim.title || sim.name || 'Untitled'
                                return (
                                    <button
                                        key={`${sim.media_type}-${sim.id}`}
                                        type="button"
                                        onClick={() => handleJumpToMedia(sim)}
                                        className="w-20 shrink-0 text-left group cursor-pointer"
                                    >
                                        {sim.poster_path ? (
                                            <img
                                                src={posterUrl(sim.poster_path, 'w185')}
                                                alt={simTitle}
                                                className="w-full aspect-[2/3] rounded-lg object-cover border border-white/10 group-hover:border-[#FF6B4A] transition"
                                            />
                                        ) : (
                                            <div className="w-full aspect-[2/3] rounded-lg bg-[#22222C]" />
                                        )}
                                        <p className="text-[10px] font-semibold text-zinc-200 group-hover:text-[#FF9F43] truncate mt-1">
                                            {simTitle}
                                        </p>
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}