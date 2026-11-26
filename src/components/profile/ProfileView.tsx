import { useEffect, useMemo, useRef, useState } from 'react'
import {
    Bookmark,
    Camera,
    Check,
    Clock,
    Crop,
    Edit3,
    Eye,
    Film,
    Lock,
    MessageSquareText,
    Star,
    Trash2,
    Upload,
    UserPlus,
    Users,
    X,
    ZoomIn,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { posterUrl } from '../../lib/tmdb'
import { fileToDataUrl, renderCroppedAvatar } from '../../lib/avatarCrop'
import type { MediaLog, Profile } from '../../types/database'
import type { SelectedMedia } from '../media/MediaModal'

const AVAILABLE_INTERESTS = [
    'Superheroes',
    'Horror',
    'Sci-Fi',
    'Thrillers',
    'Anime',
    'Drama',
    'Action',
    'Comedy',
    'Mystery',
    'Indie',
]

type ProfileTab = 'watched' | 'watchlist' | 'reviews'
type SocialListModal = 'followers' | 'following' | 'mutuals' | null

interface ProfileViewProps {
    targetUserId: string
    allLogs: MediaLog[]
    myLogs: MediaLog[]
    friendIds: Set<string>
    outgoingRequestIds: Set<string>
    onFollowUser: (targetUserId: string) => Promise<void>
    onOpenMedia: (media: SelectedMedia) => void
    onSelectUserProfile?: (userId: string) => void
    onLogsUpdated: () => void
    onProfileUpdated?: () => void
}

export function ProfileView({
                                targetUserId,
                                allLogs,
                                myLogs,
                                friendIds,
                                outgoingRequestIds,
                                onFollowUser,
                                onOpenMedia,
                                onSelectUserProfile,
                                onLogsUpdated,
                                onProfileUpdated,
                            }: ProfileViewProps) {
    const { user, profile: authProfile } = useAuth()
    const isOwnProfile = Boolean(user && user.id === targetUserId)

    const [profileData, setProfileData] = useState<Profile | null>(null)
    const [loadingProfile, setLoadingProfile] = useState(true)
    const [activeTab, setActiveTab] = useState<ProfileTab>('watched')
    const [socialModal, setSocialModal] = useState<SocialListModal>(null)

    const [followersList, setFollowersList] = useState<Profile[]>([])
    const [followingList, setFollowingList] = useState<Profile[]>([])
    const [viewerFollowingIds, setViewerFollowingIds] = useState<Set<string>>(new Set())

    const fileInputRef = useRef<HTMLInputElement | null>(null)
    const avatarMenuRef = useRef<HTMLDivElement | null>(null)
    const [avatarMenuOpen, setAvatarMenuOpen] = useState(false)
    const [uploadingAvatar, setUploadingAvatar] = useState(false)

    const [cropSourceUrl, setCropSourceUrl] = useState<string | null>(null)
    const [cropSaveMode, setCropSaveMode] = useState<'immediate' | 'edit-draft'>('immediate')
    const [cropZoom, setCropZoom] = useState(1)
    const [cropOffset, setCropOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const [isDraggingCrop, setIsDraggingCrop] = useState(false)
    const dragStartRef = useRef<{
        clientX: number
        clientY: number
        startX: number
        startY: number
    } | null>(null)

    const [cameraOpen, setCameraOpen] = useState(false)
    const [cameraError, setCameraError] = useState<string | null>(null)
    const videoRef = useRef<HTMLVideoElement | null>(null)
    const streamRef = useRef<MediaStream | null>(null)

    const [editOpen, setEditOpen] = useState(false)
    const [displayName, setDisplayName] = useState('')
    const [pronouns, setPronouns] = useState('')
    const [bio, setBio] = useState('')
    const [avatarUrl, setAvatarUrl] = useState('')
    const [selectedInterests, setSelectedInterests] = useState<string[]>([])
    const [watchedVisibility, setWatchedVisibility] = useState<'everyone' | 'followers'>(
        'everyone'
    )
    const [savingProfile, setSavingProfile] = useState(false)
    const [saveError, setSaveError] = useState<string | null>(null)
    const [togglingWatchlistKey, setTogglingWatchlistKey] = useState<string | null>(null)

    useEffect(() => {
        if (!avatarMenuOpen) return
        function handleOutsideClick(e: MouseEvent) {
            if (avatarMenuRef.current && !avatarMenuRef.current.contains(e.target as Node)) {
                setAvatarMenuOpen(false)
            }
        }
        document.addEventListener('mousedown', handleOutsideClick)
        return () => document.removeEventListener('mousedown', handleOutsideClick)
    }, [avatarMenuOpen])

    useEffect(() => {
        if (!cameraOpen) {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach((t) => t.stop())
                streamRef.current = null
            }
            return
        }

        let cancelled = false
        setCameraError(null)

        navigator.mediaDevices
            ?.getUserMedia({ video: { facingMode: 'user', width: 720, height: 720 }, audio: false })
            .then((stream) => {
                if (cancelled) {
                    stream.getTracks().forEach((t) => t.stop())
                    return
                }
                streamRef.current = stream
                if (videoRef.current) {
                    videoRef.current.srcObject = stream
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setCameraError('Could not access camera. Check browser permissions or upload a file.')
                }
            })

        return () => {
            cancelled = true
            if (streamRef.current) {
                streamRef.current.getTracks().forEach((t) => t.stop())
                streamRef.current = null
            }
        }
    }, [cameraOpen])

    useEffect(() => {
        let cancelled = false
        setLoadingProfile(true)

        async function loadProfileAndSocial() {
            const [
                { data: profRow },
                { data: incomingFollows },
                { data: outgoingFollows },
                { data: myFollows },
            ] = await Promise.all([
                supabase.from('profiles').select('*').eq('id', targetUserId).single(),
                supabase
                    .from('friendships')
                    .select('requester:profiles!friendships_requester_id_fkey(*)')
                    .eq('addressee_id', targetUserId)
                    .eq('status', 'accepted'),
                supabase
                    .from('friendships')
                    .select('addressee:profiles!friendships_addressee_id_fkey(*)')
                    .eq('requester_id', targetUserId)
                    .eq('status', 'accepted'),
                user
                    ? supabase
                        .from('friendships')
                        .select('addressee_id')
                        .eq('requester_id', user.id)
                        .eq('status', 'accepted')
                    : Promise.resolve({ data: [] }),
            ])

            if (cancelled) return

            const loadedProfile = (profRow as Profile) ?? null
            setProfileData(loadedProfile)

            if (loadedProfile) {
                setDisplayName(loadedProfile.display_name ?? '')
                setPronouns(loadedProfile.pronouns ?? '')
                setBio(loadedProfile.bio ?? '')
                setAvatarUrl(loadedProfile.avatar_url ?? '')
                setSelectedInterests(loadedProfile.interests ?? [])
                setWatchedVisibility(loadedProfile.watched_visibility ?? 'everyone')
            }

            const followers = (
                (incomingFollows as unknown as { requester: Profile | Profile[] | null }[]) ?? []
            )
                .map((r) => (Array.isArray(r.requester) ? r.requester[0] : r.requester))
                .filter((p): p is Profile => Boolean(p))

            const following = (
                (outgoingFollows as unknown as { addressee: Profile | Profile[] | null }[]) ?? []
            )
                .map((r) => (Array.isArray(r.addressee) ? r.addressee[0] : r.addressee))
                .filter((p): p is Profile => Boolean(p))

            setFollowersList(followers)
            setFollowingList(following)

            const viewerSet = new Set<string>(
                ((myFollows as { addressee_id: string }[]) ?? []).map((r) => r.addressee_id)
            )
            if (user) {
                friendIds.forEach((id) => viewerSet.add(id))
            }
            setViewerFollowingIds(viewerSet)
            setLoadingProfile(false)
        }

        loadProfileAndSocial()
        return () => {
            cancelled = true
        }
    }, [targetUserId, user, friendIds, authProfile])

    const mutualsList = useMemo(() => {
        return followersList.filter((person) => viewerFollowingIds.has(person.id))
    }, [followersList, viewerFollowingIds])

    const targetLogs = useMemo(
        () => allLogs.filter((l) => l.user_id === targetUserId),
        [allLogs, targetUserId]
    )

    const visibility = profileData?.watched_visibility ?? 'everyone'
    const canViewWatched =
        isOwnProfile || visibility === 'everyone' || friendIds.has(targetUserId)

    const watchedLogs = useMemo(
        () => targetLogs.filter((l) => l.status === 'watched' || l.status === 'watching'),
        [targetLogs]
    )

    const watchlistLogs = useMemo(
        () => targetLogs.filter((l) => l.status === 'watchlist'),
        [targetLogs]
    )

    const reviewLogs = useMemo(
        () => targetLogs.filter((l) => Boolean(l.review_text && l.review_text.trim().length > 0)),
        [targetLogs]
    )

    const myWatchlistKeys = useMemo(() => {
        const keys = new Set<string>()
        for (const log of myLogs) {
            if (log.status === 'watchlist') {
                keys.add(`${log.media_type}-${log.tmdb_id}`)
            }
        }
        return keys
    }, [myLogs])

    function openInteractiveCropper(src: string, mode: 'immediate' | 'edit-draft') {
        setCropZoom(1)
        setCropOffset({ x: 0, y: 0 })
        setCropSaveMode(mode)
        setCropSourceUrl(src)
    }

    async function handleFileSelected(file: File, mode: 'immediate' | 'edit-draft') {
        setSaveError(null)
        try {
            const rawDataUrl = await fileToDataUrl(file)
            openInteractiveCropper(rawDataUrl, mode)
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : 'Could not load image')
        }
    }

    function handleSnapCameraPhoto() {
        const video = videoRef.current
        if (!video || !video.videoWidth || !video.videoHeight) return

        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        ctx.translate(canvas.width, 0)
        ctx.scale(-1, 1)
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

        const snappedUrl = canvas.toDataURL('image/jpeg', 0.92)
        setCameraOpen(false)
        openInteractiveCropper(snappedUrl, editOpen ? 'edit-draft' : 'immediate')
    }

    async function handleConfirmCrop() {
        if (!cropSourceUrl) return
        setUploadingAvatar(true)
        setSaveError(null)

        try {
            const cropped = await renderCroppedAvatar(
                cropSourceUrl,
                { zoom: cropZoom, offsetX: cropOffset.x, offsetY: cropOffset.y },
                400
            )
            setAvatarUrl(cropped)
            setCropSourceUrl(null)

            if (cropSaveMode === 'immediate' && user) {
                const { data, error } = await supabase
                    .from('profiles')
                    .update({ avatar_url: cropped })
                    .eq('id', user.id)
                    .select('*')
                    .single()

                if (error) {
                    setSaveError(error.message)
                } else if (data) {
                    setProfileData(data as Profile)
                    onProfileUpdated?.()
                }
            }
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : 'Failed to crop image')
        } finally {
            setUploadingAvatar(false)
        }
    }

    async function handleDeleteAvatar(mode: 'immediate' | 'edit-draft') {
        setAvatarMenuOpen(false)
        setAvatarUrl('')

        if (mode === 'immediate' && user) {
            setUploadingAvatar(true)
            const { data, error } = await supabase
                .from('profiles')
                .update({ avatar_url: null })
                .eq('id', user.id)
                .select('*')
                .single()
            setUploadingAvatar(false)

            if (error) {
                setSaveError(error.message)
            } else if (data) {
                setProfileData(data as Profile)
                onProfileUpdated?.()
            }
        }
    }

    async function handleToggleWatchlist(item: {
        tmdb_id: number
        media_type: 'movie' | 'tv'
        title: string
        poster_path: string | null
    }) {
        if (!user) return
        const key = `${item.media_type}-${item.tmdb_id}`
        setTogglingWatchlistKey(key)

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
            onLogsUpdated()
        } finally {
            setTogglingWatchlistKey(null)
        }
    }

    function toggleInterestPill(interest: string) {
        setSelectedInterests((prev) =>
            prev.includes(interest) ? prev.filter((i) => i !== interest) : [...prev, interest]
        )
    }

    async function handleSaveProfile(e: React.FormEvent) {
        e.preventDefault()
        if (!user) return
        setSaveError(null)
        setSavingProfile(true)

        const updates = {
            display_name: displayName.trim() || null,
            pronouns: pronouns.trim() || null,
            bio: bio.trim() || null,
            avatar_url: avatarUrl.trim() || null,
            interests: selectedInterests,
            watched_visibility: watchedVisibility,
        }

        const { data, error } = await supabase
            .from('profiles')
            .update(updates)
            .eq('id', user.id)
            .select('*')
            .single()

        setSavingProfile(false)

        if (error) {
            setSaveError(error.message)
            return
        }

        if (data) setProfileData(data as Profile)
        setEditOpen(false)
        onProfileUpdated?.()
    }

    if (loadingProfile) {
        return (
            <div className="bg-[#18181F] border border-white/10 rounded-2xl p-8 text-center text-xs text-zinc-400">
                Loading profile...
            </div>
        )
    }

    if (!profileData) {
        return (
            <div className="bg-[#18181F] border border-white/10 rounded-2xl p-8 text-center text-xs text-zinc-400">
                Profile not found.
            </div>
        )
    }

    const handle = profileData.username
    const visibleDisplayName = profileData.display_name || handle
    const interests = profileData.interests ?? []
    const isFollowingTarget = friendIds.has(targetUserId)
    const isRequestedTarget = outgoingRequestIds.has(targetUserId)
    const followingCount = isOwnProfile ? friendIds.size : followingList.length

    const modalUsers =
        socialModal === 'followers'
            ? followersList
            : socialModal === 'following'
                ? followingList
                : mutualsList

    return (
        <div className="space-y-6">
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleFileSelected(f, editOpen ? 'edit-draft' : 'immediate')
                    e.target.value = ''
                }}
            />

            <section className="bg-[#18181F] border border-white/10 rounded-2xl p-5 sm:p-6">
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5 sm:gap-8">
                    <div ref={avatarMenuRef} className="relative shrink-0">
                        <button
                            type="button"
                            disabled={!isOwnProfile || uploadingAvatar}
                            onClick={() => {
                                if (!isOwnProfile) return
                                setAvatarMenuOpen((o) => !o)
                            }}
                            title={
                                isOwnProfile
                                    ? profileData.avatar_url
                                        ? 'Click for photo options'
                                        : 'Click to add profile photo'
                                    : visibleDisplayName
                            }
                            className={`relative w-20 h-20 sm:w-24 sm:h-24 rounded-full group ${
                                isOwnProfile ? 'cursor-pointer' : 'cursor-default'
                            }`}
                        >
                            {profileData.avatar_url ? (
                                <img
                                    src={profileData.avatar_url}
                                    alt={visibleDisplayName}
                                    className="w-full h-full rounded-full object-cover border-2 border-[#FF6B4A]/50"
                                />
                            ) : (
                                <div className="w-full h-full rounded-full bg-gradient-to-br from-[#FF6B4A] to-[#FF9F43] flex items-center justify-center text-2xl sm:text-3xl font-bold uppercase text-white">
                                    {handle[0]}
                                </div>
                            )}

                            {isOwnProfile && (
                                <span className="absolute inset-0 rounded-full bg-black/55 opacity-0 group-hover:opacity-100 transition flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold text-white">
                                    <Camera className="w-4 h-4 text-[#FF9F43]" />
                                    <span>{uploadingAvatar ? 'Saving...' : 'Photo'}</span>
                                </span>
                            )}
                        </button>

                        {isOwnProfile && avatarMenuOpen && (
                            <div className="absolute left-0 mt-2 w-56 bg-[#18181F] border border-white/15 rounded-2xl shadow-2xl overflow-hidden z-40">
                                <div className="p-1.5 space-y-1">
                                    {profileData.avatar_url && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setAvatarMenuOpen(false)
                                                openInteractiveCropper(profileData.avatar_url!, 'immediate')
                                            }}
                                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-zinc-200 hover:bg-[#22222C] transition cursor-pointer text-left"
                                        >
                                            <Crop className="w-3.5 h-3.5 text-[#FF9F43]" />
                                            <span>Edit photo</span>
                                        </button>
                                    )}

                                    <button
                                        type="button"
                                        onClick={() => {
                                            setAvatarMenuOpen(false)
                                            fileInputRef.current?.click()
                                        }}
                                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-zinc-200 hover:bg-[#22222C] transition cursor-pointer text-left"
                                    >
                                        <Upload className="w-3.5 h-3.5 text-[#FF6B4A]" />
                                        <span>Upload from computer</span>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => {
                                            setAvatarMenuOpen(false)
                                            setCameraOpen(true)
                                        }}
                                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-zinc-200 hover:bg-[#22222C] transition cursor-pointer text-left"
                                    >
                                        <Camera className="w-3.5 h-3.5 text-sky-400" />
                                        <span>Take photo with camera</span>
                                    </button>

                                    {profileData.avatar_url && (
                                        <button
                                            type="button"
                                            onClick={() => handleDeleteAvatar('immediate')}
                                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-red-400 hover:bg-red-500/10 transition cursor-pointer text-left border-t border-white/10 mt-1 pt-2"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                            <span>Delete photo</span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex-1 min-w-0 space-y-2.5 w-full">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5 flex-wrap min-w-0">
                                <h1 className="text-lg sm:text-xl font-bold text-white truncate">
                                    {handle}
                                </h1>
                                {profileData.pronouns && (
                                    <span className="text-xs font-medium text-zinc-400 bg-white/5 px-2.5 py-0.5 rounded-full">
                                        {profileData.pronouns}
                                    </span>
                                )}
                            </div>

                            {isOwnProfile ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSaveError(null)
                                        setDisplayName(profileData.display_name ?? '')
                                        setPronouns(profileData.pronouns ?? '')
                                        setBio(profileData.bio ?? '')
                                        setAvatarUrl(profileData.avatar_url ?? '')
                                        setSelectedInterests(profileData.interests ?? [])
                                        setWatchedVisibility(profileData.watched_visibility ?? 'everyone')
                                        setEditOpen(true)
                                    }}
                                    className="px-3.5 py-1.5 rounded-xl bg-[#22222C] hover:bg-[#2B2B38] border border-white/15 text-xs font-semibold text-white flex items-center gap-1.5 transition cursor-pointer"
                                >
                                    <Edit3 className="w-3.5 h-3.5 text-[#FF9F43]" /> Edit profile
                                </button>
                            ) : isFollowingTarget ? (
                                <span className="px-3.5 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-semibold flex items-center gap-1.5">
                                    <Check className="w-3.5 h-3.5" /> Following
                                </span>
                            ) : isRequestedTarget ? (
                                <span className="px-3.5 py-1.5 rounded-xl bg-[#22222C] text-zinc-400 text-xs font-semibold flex items-center gap-1.5">
                                    <Clock className="w-3.5 h-3.5" /> Requested
                                </span>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => onFollowUser(targetUserId)}
                                    className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-[#FF6B4A] to-[#FF9F43] text-white text-xs font-semibold flex items-center gap-1.5 hover:opacity-95 transition cursor-pointer"
                                >
                                    <UserPlus className="w-3.5 h-3.5" /> Follow
                                </button>
                            )}
                        </div>

                        <p className="text-sm font-semibold text-zinc-100">{visibleDisplayName}</p>

                        <div className="flex items-center gap-5 flex-wrap text-xs">
                            <span>
                                <strong className="text-white font-bold">{watchedLogs.length}</strong>{' '}
                                <span className="text-zinc-400">watched</span>
                            </span>

                            <button
                                type="button"
                                onClick={() => setSocialModal('followers')}
                                className="hover:underline cursor-pointer"
                            >
                                <strong className="text-white font-bold">{followersList.length}</strong>{' '}
                                <span className="text-zinc-400">followers</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => setSocialModal('following')}
                                className="hover:underline cursor-pointer"
                            >
                                <strong className="text-white font-bold">{followingCount}</strong>{' '}
                                <span className="text-zinc-400">following</span>
                            </button>

                            {!isOwnProfile && (
                                <button
                                    type="button"
                                    onClick={() => setSocialModal('mutuals')}
                                    className="hover:underline cursor-pointer text-[#FF9F43]"
                                >
                                    <strong className="font-bold">{mutualsList.length}</strong>{' '}
                                    <span>mutuals</span>
                                </button>
                            )}
                        </div>

                        {profileData.bio && (
                            <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed whitespace-pre-line">
                                {profileData.bio}
                            </p>
                        )}

                        {interests.length > 0 && (
                            <div className="flex items-center gap-1.5 flex-wrap pt-1">
                                {interests.map((tag) => (
                                    <span
                                        key={tag}
                                        className="px-2.5 py-0.5 rounded-full bg-[#22222C] border border-white/10 text-[11px] font-semibold text-[#FF9F43]"
                                    >
                                        #{tag}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </section>

            <div className="border-b border-white/10 flex items-center justify-around">
                <button
                    type="button"
                    onClick={() => setActiveTab('watched')}
                    className={`flex-1 py-3 text-xs font-semibold flex items-center justify-center gap-2 border-b-2 transition cursor-pointer ${
                        activeTab === 'watched'
                            ? 'border-[#FF6B4A] text-white'
                            : 'border-transparent text-zinc-400 hover:text-zinc-200'
                    }`}
                >
                    <Eye className="w-4 h-4" />
                    <span>Watched Library</span>
                    {visibility === 'followers' && (
                        <span title="Followers only" className="inline-flex">
                            <Lock className="w-3 h-3 text-[#FF9F43]" />
                        </span>
                    )}
                </button>

                <button
                    type="button"
                    onClick={() => setActiveTab('watchlist')}
                    className={`flex-1 py-3 text-xs font-semibold flex items-center justify-center gap-2 border-b-2 transition cursor-pointer ${
                        activeTab === 'watchlist'
                            ? 'border-[#FF6B4A] text-white'
                            : 'border-transparent text-zinc-400 hover:text-zinc-200'
                    }`}
                >
                    <Bookmark className="w-4 h-4" />
                    <span>Watchlist ({watchlistLogs.length})</span>
                </button>

                <button
                    type="button"
                    onClick={() => setActiveTab('reviews')}
                    className={`flex-1 py-3 text-xs font-semibold flex items-center justify-center gap-2 border-b-2 transition cursor-pointer ${
                        activeTab === 'reviews'
                            ? 'border-[#FF6B4A] text-white'
                            : 'border-transparent text-zinc-400 hover:text-zinc-200'
                    }`}
                >
                    <MessageSquareText className="w-4 h-4" />
                    <span>Reviews ({reviewLogs.length})</span>
                </button>
            </div>

            {activeTab === 'watched' && (
                <div>
                    {!canViewWatched ? (
                        <div className="bg-[#18181F] border border-white/10 rounded-2xl p-10 text-center space-y-2">
                            <Lock className="w-7 h-7 text-[#FF9F43] mx-auto" />
                            <p className="text-sm font-bold text-white">Followers Only</p>
                            <p className="text-xs text-zinc-400 max-w-xs mx-auto">
                                @{handle} set their Watched Library to followers only. Follow them to view their watched titles.
                            </p>
                        </div>
                    ) : watchedLogs.length === 0 ? (
                        <div className="bg-[#18181F] border border-white/10 rounded-2xl p-10 text-center space-y-1">
                            <Film className="w-7 h-7 text-zinc-500 mx-auto" />
                            <p className="text-sm font-semibold text-zinc-200">No watched titles yet</p>
                            <p className="text-xs text-zinc-400">
                                Movies and shows marked as watching or watched will appear here.
                            </p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5">
                            {watchedLogs.map((log) => {
                                const key = `${log.media_type}-${log.tmdb_id}`
                                const inWatchlist = myWatchlistKeys.has(key)
                                const busy = togglingWatchlistKey === key

                                return (
                                    <div
                                        key={log.id}
                                        className="bg-[#18181F] border border-white/10 rounded-2xl overflow-hidden flex flex-col justify-between group"
                                    >
                                        <div
                                            onClick={() =>
                                                onOpenMedia({
                                                    tmdb_id: log.tmdb_id,
                                                    media_type: log.media_type,
                                                    title: log.title,
                                                    poster_path: log.poster_path,
                                                })
                                            }
                                            className="cursor-pointer"
                                        >
                                            {log.poster_path ? (
                                                <img
                                                    src={posterUrl(log.poster_path, 'w342')}
                                                    alt={log.title}
                                                    className="w-full aspect-[2/3] object-cover group-hover:scale-[1.02] transition"
                                                />
                                            ) : (
                                                <div className="w-full aspect-[2/3] bg-[#22222C] flex items-center justify-center text-zinc-500 text-xs">
                                                    No Poster
                                                </div>
                                            )}
                                            <div className="p-2.5 pb-1">
                                                <p className="text-xs font-bold text-white truncate">{log.title}</p>
                                                <p className="text-[10px] text-zinc-400 mt-0.5 flex items-center justify-between">
                                                    <span>{log.media_type === 'tv' ? 'TV' : 'Movie'}</span>
                                                    {log.rating !== null && (
                                                        <span className="text-[#FF9F43] font-semibold">★ {log.rating}</span>
                                                    )}
                                                </p>
                                            </div>
                                        </div>

                                        {user && (
                                            <div className="p-2.5 pt-1.5">
                                                <button
                                                    type="button"
                                                    disabled={busy}
                                                    onClick={() => handleToggleWatchlist(log)}
                                                    className={`w-full py-1.5 rounded-xl text-[11px] font-semibold flex items-center justify-center gap-1 transition cursor-pointer ${
                                                        inWatchlist
                                                            ? 'bg-[#FF6B4A]/20 text-[#FF9F43] border border-[#FF6B4A]/40'
                                                            : 'bg-[#22222C] hover:bg-[#2C2C38] text-zinc-300'
                                                    }`}
                                                >
                                                    <Bookmark
                                                        className={`w-3 h-3 ${inWatchlist ? 'fill-[#FF9F43]' : ''}`}
                                                    />
                                                    {inWatchlist ? 'In Watchlist' : 'Watchlist'}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'watchlist' && (
                <div>
                    {watchlistLogs.length === 0 ? (
                        <div className="bg-[#18181F] border border-white/10 rounded-2xl p-10 text-center space-y-1">
                            <Bookmark className="w-7 h-7 text-zinc-500 mx-auto" />
                            <p className="text-sm font-semibold text-zinc-200">Watchlist is empty</p>
                            <p className="text-xs text-zinc-400">
                                Save movies and shows to build a watchlist you can toggle anytime.
                            </p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5">
                            {watchlistLogs.map((log) => {
                                const key = `${log.media_type}-${log.tmdb_id}`
                                const inWatchlist = myWatchlistKeys.has(key)
                                const busy = togglingWatchlistKey === key

                                return (
                                    <div
                                        key={log.id}
                                        className="bg-[#18181F] border border-white/10 rounded-2xl overflow-hidden flex flex-col justify-between"
                                    >
                                        <div
                                            onClick={() =>
                                                onOpenMedia({
                                                    tmdb_id: log.tmdb_id,
                                                    media_type: log.media_type,
                                                    title: log.title,
                                                    poster_path: log.poster_path,
                                                })
                                            }
                                            className="cursor-pointer"
                                        >
                                            {log.poster_path ? (
                                                <img
                                                    src={posterUrl(log.poster_path, 'w342')}
                                                    alt={log.title}
                                                    className="w-full aspect-[2/3] object-cover"
                                                />
                                            ) : (
                                                <div className="w-full aspect-[2/3] bg-[#22222C]" />
                                            )}
                                            <div className="p-2.5 pb-1">
                                                <p className="text-xs font-bold text-white truncate">{log.title}</p>
                                                <p className="text-[10px] text-zinc-400 mt-0.5">
                                                    {log.media_type === 'tv' ? 'TV Series' : 'Movie'}
                                                </p>
                                            </div>
                                        </div>

                                        {user && (
                                            <div className="p-2.5 pt-1.5">
                                                <button
                                                    type="button"
                                                    disabled={busy}
                                                    onClick={() => handleToggleWatchlist(log)}
                                                    className={`w-full py-1.5 rounded-xl text-[11px] font-semibold flex items-center justify-center gap-1 transition cursor-pointer ${
                                                        isOwnProfile || inWatchlist
                                                            ? 'bg-[#FF6B4A] hover:bg-[#FF9F43] text-white'
                                                            : 'bg-[#22222C] hover:bg-[#2C2C38] text-zinc-200'
                                                    }`}
                                                >
                                                    <Bookmark className="w-3 h-3 fill-current" />
                                                    {isOwnProfile
                                                        ? 'Remove from Watchlist'
                                                        : inWatchlist
                                                            ? 'Saved in Watchlist'
                                                            : 'Add to Watchlist'}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'reviews' && (
                <div className="space-y-3">
                    {reviewLogs.length === 0 ? (
                        <div className="bg-[#18181F] border border-white/10 rounded-2xl p-10 text-center space-y-1">
                            <MessageSquareText className="w-7 h-7 text-zinc-500 mx-auto" />
                            <p className="text-sm font-semibold text-zinc-200">No written reviews yet</p>
                            <p className="text-xs text-zinc-400">
                                Reviews written on movies or TV shows will appear here.
                            </p>
                        </div>
                    ) : (
                        reviewLogs.map((rev) => (
                            <div
                                key={rev.id}
                                onClick={() =>
                                    onOpenMedia({
                                        tmdb_id: rev.tmdb_id,
                                        media_type: rev.media_type,
                                        title: rev.title,
                                        poster_path: rev.poster_path,
                                    })
                                }
                                className="bg-[#18181F] hover:bg-[#1E1E27] border border-white/10 rounded-2xl p-4 flex items-start gap-3.5 transition cursor-pointer"
                            >
                                {rev.poster_path ? (
                                    <img
                                        src={posterUrl(rev.poster_path, 'w185')}
                                        alt={rev.title}
                                        className="w-12 h-16 rounded-xl object-cover shrink-0"
                                    />
                                ) : (
                                    <div className="w-12 h-16 rounded-xl bg-[#22222C] shrink-0" />
                                )}

                                <div className="min-w-0 flex-1 space-y-1">
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="text-sm font-bold text-white truncate">{rev.title}</p>
                                        {rev.rating !== null && (
                                            <span className="text-xs font-bold text-[#FF9F43] flex items-center gap-0.5 shrink-0">
                                                <Star className="w-3.5 h-3.5 fill-[#FF9F43]" /> {rev.rating}/5
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-xs text-zinc-300 leading-relaxed">{rev.review_text}</p>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}

            {cropSourceUrl && (
                <div
                    onClick={() => setCropSourceUrl(null)}
                    className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4"
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        className="w-full max-w-md bg-[#18181F] border border-white/15 rounded-2xl overflow-hidden shadow-2xl"
                    >
                        <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between">
                            <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                <Crop className="w-4 h-4 text-[#FF9F43]" /> Reposition & Crop Photo
                            </h3>
                            <button
                                type="button"
                                onClick={() => setCropSourceUrl(null)}
                                className="text-zinc-400 hover:text-white cursor-pointer p-1"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="p-5 space-y-4">
                            <div
                                onPointerDown={(e) => {
                                    e.currentTarget.setPointerCapture(e.pointerId)
                                    setIsDraggingCrop(true)
                                    dragStartRef.current = {
                                        clientX: e.clientX,
                                        clientY: e.clientY,
                                        startX: cropOffset.x,
                                        startY: cropOffset.y,
                                    }
                                }}
                                onPointerMove={(e) => {
                                    if (!isDraggingCrop || !dragStartRef.current) return
                                    const dx = (e.clientX - dragStartRef.current.clientX) / 110
                                    const dy = (e.clientY - dragStartRef.current.clientY) / 110
                                    setCropOffset({
                                        x: Math.max(-1, Math.min(1, dragStartRef.current.startX + dx)),
                                        y: Math.max(-1, Math.min(1, dragStartRef.current.startY + dy)),
                                    })
                                }}
                                onPointerUp={() => {
                                    setIsDraggingCrop(false)
                                    dragStartRef.current = null
                                }}
                                className="relative w-64 h-64 mx-auto rounded-2xl bg-black overflow-hidden border border-white/15 select-none touch-none cursor-grab active:cursor-grabbing"
                            >
                                <img
                                    src={cropSourceUrl}
                                    alt="Crop preview"
                                    draggable={false}
                                    style={{
                                        transform: `translate(${cropOffset.x * 45}px, ${cropOffset.y * 45}px) scale(${cropZoom})`,
                                    }}
                                    className="w-full h-full object-cover pointer-events-none transition-transform duration-75"
                                />

                                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                                    <div className="w-56 h-56 rounded-full border-2 border-[#FF9F43] shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] relative overflow-hidden">
                                        <div className="absolute inset-y-0 left-1/3 w-px bg-white/30" />
                                        <div className="absolute inset-y-0 left-2/3 w-px bg-white/30" />
                                        <div className="absolute inset-x-0 top-1/3 h-px bg-white/30" />
                                        <div className="absolute inset-x-0 top-2/3 h-px bg-white/30" />
                                        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 border border-[#FF6B4A]/90 rounded-full" />
                                    </div>
                                </div>
                            </div>

                            <p className="text-[11px] text-zinc-400 text-center">
                                Drag photo to position inside the circle guidelines
                            </p>

                            <div className="flex items-center gap-3 px-2">
                                <ZoomIn className="w-4 h-4 text-zinc-400 shrink-0" />
                                <input
                                    type="range"
                                    min={1}
                                    max={3}
                                    step={0.05}
                                    value={cropZoom}
                                    onChange={(e) => setCropZoom(Number(e.target.value))}
                                    className="flex-1 accent-[#FF6B4A] cursor-pointer"
                                />
                                <span className="text-[11px] font-mono text-zinc-400 w-10 text-right">
                                    {cropZoom.toFixed(1)}x
                                </span>
                            </div>
                        </div>

                        <div className="px-5 py-3.5 border-t border-white/10 bg-[#14141A] flex items-center justify-between gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setCropZoom(1)
                                    setCropOffset({ x: 0, y: 0 })
                                }}
                                className="px-3 py-1.5 rounded-xl bg-[#22222C] text-xs font-semibold text-zinc-300 cursor-pointer"
                            >
                                Re-center
                            </button>

                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setCropSourceUrl(null)}
                                    className="px-3.5 py-1.5 rounded-xl bg-[#22222C] text-xs font-semibold text-zinc-300 cursor-pointer"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    disabled={uploadingAvatar}
                                    onClick={handleConfirmCrop}
                                    className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-[#FF6B4A] to-[#FF9F43] text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                                >
                                    {uploadingAvatar ? 'Applying...' : 'Apply Photo'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {cameraOpen && (
                <div
                    onClick={() => setCameraOpen(false)}
                    className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4"
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        className="w-full max-w-md bg-[#18181F] border border-white/15 rounded-2xl overflow-hidden shadow-2xl"
                    >
                        <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between">
                            <h3 className="text-sm font-bold text-white flex items-center gap-2">
                                <Camera className="w-4 h-4 text-[#FF6B4A]" /> Take Profile Photo
                            </h3>
                            <button
                                type="button"
                                onClick={() => setCameraOpen(false)}
                                className="text-zinc-400 hover:text-white cursor-pointer p-1"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="p-5 space-y-4">
                            {cameraError ? (
                                <p className="text-xs text-red-400 text-center py-8">{cameraError}</p>
                            ) : (
                                <div className="relative w-64 h-64 mx-auto rounded-full overflow-hidden border-2 border-[#FF6B4A] bg-black">
                                    <video
                                        ref={videoRef}
                                        autoPlay
                                        playsInline
                                        muted
                                        className="w-full h-full object-cover -scale-x-100"
                                    />
                                </div>
                            )}
                        </div>

                        <div className="px-5 py-3.5 border-t border-white/10 bg-[#14141A] flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setCameraOpen(false)}
                                className="px-3.5 py-1.5 rounded-xl bg-[#22222C] text-xs font-semibold text-zinc-300 cursor-pointer"
                            >
                                Cancel
                            </button>
                            {!cameraError && (
                                <button
                                    type="button"
                                    onClick={handleSnapCameraPhoto}
                                    className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-[#FF6B4A] to-[#FF9F43] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                                >
                                    <Camera className="w-3.5 h-3.5" /> Snap & Crop
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {socialModal && (
                <div
                    onClick={() => setSocialModal(null)}
                    className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        className="w-full max-w-md bg-[#18181F] border border-white/15 rounded-2xl overflow-hidden shadow-2xl"
                    >
                        <div className="px-4 py-3.5 border-b border-white/10 flex items-center justify-between">
                            <h3 className="text-sm font-bold text-white capitalize flex items-center gap-2">
                                <Users className="w-4 h-4 text-[#FF6B4A]" />
                                {socialModal === 'mutuals'
                                    ? `Mutual Followers (${modalUsers.length})`
                                    : `${socialModal} (${modalUsers.length})`}
                            </h3>
                            <button
                                type="button"
                                onClick={() => setSocialModal(null)}
                                className="text-zinc-400 hover:text-white cursor-pointer p-1"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="max-h-80 overflow-y-auto p-3 space-y-2">
                            {modalUsers.length === 0 ? (
                                <p className="text-xs text-zinc-500 text-center py-6">
                                    No accounts in this list yet.
                                </p>
                            ) : (
                                modalUsers.map((person) => {
                                    const isMe = user?.id === person.id
                                    const followingPerson = friendIds.has(person.id)
                                    const requestedPerson = outgoingRequestIds.has(person.id)

                                    return (
                                        <div
                                            key={person.id}
                                            className="flex items-center justify-between gap-2.5 p-2 rounded-xl bg-[#14141A] border border-white/5"
                                        >
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setSocialModal(null)
                                                    onSelectUserProfile?.(person.id)
                                                }}
                                                className="flex items-center gap-2.5 min-w-0 text-left cursor-pointer group"
                                            >
                                                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#FF6B4A]/30 to-[#FF9F43]/30 border border-white/15 flex items-center justify-center font-bold text-xs uppercase text-[#FF9F43] shrink-0">
                                                    {person.username[0]}
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-xs font-bold text-white truncate group-hover:text-[#FF9F43] transition">
                                                        {person.display_name || `@${person.username}`}
                                                    </p>
                                                    <p className="text-[11px] text-zinc-400 truncate">@{person.username}</p>
                                                </div>
                                            </button>

                                            {!isMe &&
                                                (followingPerson ? (
                                                    <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-400 text-[11px] font-semibold flex items-center gap-1 shrink-0">
                                                        <Check className="w-3 h-3" /> Following
                                                    </span>
                                                ) : requestedPerson ? (
                                                    <span className="px-2.5 py-1 rounded-lg bg-[#22222C] text-zinc-400 text-[11px] font-semibold flex items-center gap-1 shrink-0">
                                                        <Clock className="w-3 h-3" /> Requested
                                                    </span>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => onFollowUser(person.id)}
                                                        className="px-3 py-1 rounded-lg bg-[#FF6B4A] hover:bg-[#FF9F43] text-white text-[11px] font-semibold flex items-center gap-1 transition cursor-pointer shrink-0"
                                                    >
                                                        <UserPlus className="w-3 h-3" /> Follow
                                                    </button>
                                                ))}
                                        </div>
                                    )
                                })
                            )}
                        </div>
                    </div>
                </div>
            )}

            {editOpen && isOwnProfile && (
                <div
                    onClick={() => setEditOpen(false)}
                    className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
                >
                    <form
                        onSubmit={handleSaveProfile}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full max-w-lg bg-[#18181F] border border-white/15 rounded-2xl overflow-hidden shadow-2xl"
                    >
                        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
                            <h2 className="text-sm font-bold text-white">Edit Profile</h2>
                            <button
                                type="button"
                                onClick={() => setEditOpen(false)}
                                className="text-zinc-400 hover:text-white cursor-pointer p-1"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="p-5 space-y-4 max-h-[75dvh] overflow-y-auto">
                            <div className="flex items-center gap-4">
                                {avatarUrl ? (
                                    <img
                                        src={avatarUrl}
                                        alt="Avatar preview"
                                        className="w-16 h-16 rounded-full object-cover border border-white/15 shrink-0"
                                    />
                                ) : (
                                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#FF6B4A] to-[#FF9F43] flex items-center justify-center text-xl font-bold uppercase text-white shrink-0">
                                        {handle[0]}
                                    </div>
                                )}

                                <div className="flex flex-wrap gap-2">
                                    {avatarUrl && (
                                        <button
                                            type="button"
                                            onClick={() => openInteractiveCropper(avatarUrl, 'edit-draft')}
                                            className="px-3 py-1.5 rounded-xl bg-[#22222C] hover:bg-[#2C2C38] border border-white/15 text-xs font-semibold text-[#FF9F43] flex items-center gap-1.5 transition cursor-pointer"
                                        >
                                            <Crop className="w-3.5 h-3.5" /> Reposition
                                        </button>
                                    )}

                                    <button
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        className="px-3 py-1.5 rounded-xl bg-[#22222C] hover:bg-[#2C2C38] border border-white/15 text-xs font-semibold text-white flex items-center gap-1.5 transition cursor-pointer"
                                    >
                                        <Upload className="w-3.5 h-3.5 text-[#FF6B4A]" /> Upload
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => setCameraOpen(true)}
                                        className="px-3 py-1.5 rounded-xl bg-[#22222C] hover:bg-[#2C2C38] border border-white/15 text-xs font-semibold text-white flex items-center gap-1.5 transition cursor-pointer"
                                    >
                                        <Camera className="w-3.5 h-3.5 text-sky-400" /> Camera
                                    </button>

                                    {avatarUrl && (
                                        <button
                                            type="button"
                                            onClick={() => handleDeleteAvatar('edit-draft')}
                                            className="px-3 py-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 text-xs font-semibold text-red-400 flex items-center gap-1.5 transition cursor-pointer"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" /> Delete
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
                                        Display Name
                                    </label>
                                    <input
                                        type="text"
                                        value={displayName}
                                        onChange={(e) => setDisplayName(e.target.value)}
                                        placeholder="Your display name"
                                        className="w-full bg-[#22222C] border border-white/10 focus:border-[#FF6B4A] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                                    />
                                </div>

                                <div>
                                    <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
                                        Pronouns
                                    </label>
                                    <input
                                        type="text"
                                        value={pronouns}
                                        onChange={(e) => setPronouns(e.target.value)}
                                        placeholder="e.g. he/him, she/her, they/them"
                                        className="w-full bg-[#22222C] border border-white/10 focus:border-[#FF6B4A] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
                                    Bio
                                </label>
                                <textarea
                                    rows={3}
                                    value={bio}
                                    onChange={(e) => setBio(e.target.value)}
                                    placeholder="Write a short bio about what you love watching..."
                                    className="w-full bg-[#22222C] border border-white/10 focus:border-[#FF6B4A] rounded-xl px-3 py-2 text-xs text-white focus:outline-none resize-none"
                                />
                            </div>

                            <div>
                                <label className="block text-[11px] font-semibold text-zinc-400 mb-1.5">
                                    Interests (added to your profile)
                                </label>
                                <div className="flex flex-wrap gap-1.5">
                                    {AVAILABLE_INTERESTS.map((interest) => {
                                        const active = selectedInterests.includes(interest)
                                        return (
                                            <button
                                                key={interest}
                                                type="button"
                                                onClick={() => toggleInterestPill(interest)}
                                                className={`px-3 py-1 rounded-full text-xs font-semibold transition cursor-pointer ${
                                                    active
                                                        ? 'bg-gradient-to-r from-[#FF6B4A] to-[#FF9F43] text-white'
                                                        : 'bg-[#22222C] text-zinc-300 hover:text-white border border-white/10'
                                                }`}
                                            >
                                                {interest}
                                            </button>
                                        )
                                    })}
                                </div>
                            </div>

                            <div>
                                <label className="block text-[11px] font-semibold text-zinc-400 mb-1.5">
                                    Watched Library Visibility
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setWatchedVisibility('everyone')}
                                        className={`py-2 px-3 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                                            watchedVisibility === 'everyone'
                                                ? 'bg-[#FF6B4A]/20 border-[#FF6B4A] text-white'
                                                : 'bg-[#22222C] border-white/10 text-zinc-400'
                                        }`}
                                    >
                                        Everyone
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setWatchedVisibility('followers')}
                                        className={`py-2 px-3 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                                            watchedVisibility === 'followers'
                                                ? 'bg-[#FF6B4A]/20 border-[#FF6B4A] text-white'
                                                : 'bg-[#22222C] border-white/10 text-zinc-400'
                                        }`}
                                    >
                                        Followers Only
                                    </button>
                                </div>
                            </div>

                            {saveError && <p className="text-xs text-red-400">{saveError}</p>}
                        </div>

                        <div className="px-5 py-3.5 border-t border-white/10 bg-[#14141A] flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setEditOpen(false)}
                                className="px-3.5 py-1.5 rounded-xl bg-[#22222C] text-xs font-semibold text-zinc-300 cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={savingProfile}
                                className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-[#FF6B4A] to-[#FF9F43] text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                            >
                                {savingProfile ? 'Saving...' : 'Save Changes'}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    )
}