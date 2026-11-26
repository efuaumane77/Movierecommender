import { useState, useEffect, useRef } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
    Film,
    Search,
    X,
    Settings,
    User,
    Lock,
    Globe,
    LogOut,
    Sun,
    Moon,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { supabase } from '../../lib/supabase'
import { LeftRail } from './LeftRail'
import { RightRail } from './RightRail'
import { searchMulti, posterUrl, type TMDBSearchResult } from '../../lib/tmdb'
import type { MediaLog, Profile } from '../../types/database'

interface AppShellProps {
    watching: MediaLog[]
    suggestedUsers: Profile[]
    outgoingRequestIds: Set<string>
    friendIds: Set<string>
    notificationCount: number
    joinedForumSlugs: string[]
    activeForumSlug: string | null
    onFollowUser: (targetUserId: string) => Promise<void>
    onJoinOrOpenForum: (slug: string) => void
    onLeaveForum: (slug: string) => void
    onIncrementEpisode: (log: MediaLog) => void
    onOpenMedia: (item: {
        tmdb_id: number
        media_type: 'movie' | 'tv'
        title: string
        poster_path: string | null
        overview?: string
    }) => void
    onProfileUpdated?: () => void
}

export function AppShell({
                             watching,
                             suggestedUsers,
                             outgoingRequestIds,
                             friendIds,
                             notificationCount,
                             joinedForumSlugs,
                             activeForumSlug,
                             onFollowUser,
                             onJoinOrOpenForum,
                             onLeaveForum,
                             onIncrementEpisode,
                             onOpenMedia,
                             onProfileUpdated,
                         }: AppShellProps) {
    const { user, profile, signOut } = useAuth()
    const { prefs, toggleTheme } = useTheme()
    const location = useLocation()
    const navigate = useNavigate()
    const isTrailersRoute = location.pathname === '/trailers'
    const isSettingsRoute = location.pathname === '/settings'
    const isProfileRoute =
        location.pathname === '/library' || location.pathname.startsWith('/profile')
    const hideRightRail = isTrailersRoute || isSettingsRoute || isProfileRoute

    const searchInputRef = useRef<HTMLInputElement | null>(null)
    const settingsMenuRef = useRef<HTMLDivElement | null>(null)
    const [query, setQuery] = useState('')
    const [results, setResults] = useState<TMDBSearchResult[]>([])
    const [searching, setSearching] = useState(false)
    const [reviewBanner, setReviewBanner] = useState(false)

    // Top-right settings dropdown state
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [updatingPrivacy, setUpdatingPrivacy] = useState(false)

    useEffect(() => {
        const timer = setTimeout(async () => {
            if (!query.trim()) {
                setResults([])
                return
            }
            setSearching(true)
            try {
                const hits = await searchMulti(query)
                setResults(hits.slice(0, 6))
            } catch (err) {
                console.error(err)
            } finally {
                setSearching(false)
            }
        }, 300)

        return () => clearTimeout(timer)
    }, [query])

    useEffect(() => {
        if (!settingsOpen) return
        function onDocClick(e: MouseEvent) {
            if (settingsMenuRef.current && !settingsMenuRef.current.contains(e.target as Node)) {
                setSettingsOpen(false)
            }
        }
        document.addEventListener('mousedown', onDocClick)
        return () => document.removeEventListener('mousedown', onDocClick)
    }, [settingsOpen])

    function openReviewComposer() {
        setReviewBanner(true)
        window.scrollTo({ top: 0, behavior: 'smooth' })
        setTimeout(() => searchInputRef.current?.focus(), 50)
    }

    async function handleToggleWatchedPrivacy() {
        if (!user || updatingPrivacy) return
        setUpdatingPrivacy(true)
        const nextVisibility =
            profile?.watched_visibility === 'followers' ? 'everyone' : 'followers'
        await supabase
            .from('profiles')
            .update({ watched_visibility: nextVisibility })
            .eq('id', user.id)
        setUpdatingPrivacy(false)
        onProfileUpdated?.()
    }

    const displayHandle = profile?.username ?? 'user'
    const headerLabel = profile?.display_name || `@${displayHandle}`
    const isFollowersOnly = profile?.watched_visibility === 'followers'
    const isLight = prefs.theme === 'light'

    const visibleSuggestions = prefs.showAccountSuggestions ? suggestedUsers : []

    return (
        <div className="min-h-dvh bg-[#0E0E12] text-[#F4F4F6] overflow-x-clip">
            <header className="h-16 border-b border-white/10 bg-[#0E0E12]/90 backdrop-blur-md sticky top-0 z-30 px-4 md:px-6 flex items-center justify-between gap-3 md:gap-4">
                <div className="flex items-center gap-2.5 md:w-52 lg:w-60 shrink-0">
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#FF6B4A] to-[#FF9F43] flex items-center justify-center shrink-0">
                        <Film className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-lg font-bold tracking-tight hidden sm:inline">Cinerate</span>
                </div>

                <div className="relative flex-1 min-w-0 max-w-xl">
                    <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                        ref={searchInputRef}
                        type="text"
                        placeholder={
                            reviewBanner
                                ? 'Type a movie or show to write a review...'
                                : 'Search movies or TV shows...'
                        }
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onBlur={() => setReviewBanner(false)}
                        className={`w-full bg-[#18181F] border rounded-xl pl-10 pr-9 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none transition ${
                            reviewBanner
                                ? 'border-[#FF6B4A] ring-2 ring-[#FF6B4A]/30'
                                : 'border-white/10 focus:border-[#FF6B4A]'
                        }`}
                    />
                    {query && (
                        <button
                            type="button"
                            onClick={() => {
                                setQuery('')
                                setResults([])
                            }}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white cursor-pointer"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}

                    {(results.length > 0 || searching) && (
                        <div className="absolute left-0 right-0 mt-2 bg-[#18181F] border border-white/15 rounded-2xl shadow-2xl overflow-hidden z-50">
                            {searching ? (
                                <div className="p-4 text-xs text-zinc-400">Searching TMDB...</div>
                            ) : (
                                results.map((item) => {
                                    const title = item.title || item.name || 'Untitled'
                                    const year = (item.release_date || item.first_air_date || '').slice(0, 4)
                                    return (
                                        <button
                                            key={`${item.media_type}-${item.id}`}
                                            type="button"
                                            onClick={() => {
                                                onOpenMedia({
                                                    tmdb_id: item.id,
                                                    media_type: item.media_type,
                                                    title,
                                                    poster_path: item.poster_path,
                                                    overview: item.overview,
                                                })
                                                setQuery('')
                                                setResults([])
                                                setReviewBanner(false)
                                            }}
                                            className="w-full flex items-center gap-3 p-2.5 hover:bg-[#22222C] transition text-left border-b border-white/5 last:border-0 cursor-pointer"
                                        >
                                            {item.poster_path ? (
                                                <img
                                                    src={posterUrl(item.poster_path, 'w185')}
                                                    alt={title}
                                                    className="w-9 h-12 rounded-lg object-cover shrink-0"
                                                />
                                            ) : (
                                                <div className="w-9 h-12 rounded-lg bg-[#22222C] shrink-0" />
                                            )}
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-medium text-white truncate">{title}</p>
                                                <p className="text-xs text-zinc-400">
                                                    {item.media_type === 'tv' ? 'TV Series' : 'Movie'}{' '}
                                                    {year ? `• ${year}` : ''}
                                                </p>
                                            </div>
                                            <span className="text-xs font-medium text-[#FF6B4A] px-2.5 py-1 rounded-lg bg-[#FF6B4A]/10 shrink-0">
                                                + Review
                                            </span>
                                        </button>
                                    )
                                })
                            )}
                        </div>
                    )}
                </div>

                {/* Quick Light/Dark Mode Toggle + Top-Right Avatar & Settings Menu */}
                <div ref={settingsMenuRef} className="relative flex items-center gap-1.5 shrink-0">
                    <button
                        type="button"
                        onClick={toggleTheme}
                        title={isLight ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
                        className="p-2 rounded-xl bg-[#18181F] hover:bg-[#22222C] border border-white/10 text-zinc-300 hover:text-[#FF9F43] transition cursor-pointer"
                    >
                        {isLight ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                    </button>

                    <button
                        type="button"
                        onClick={() => setSettingsOpen((o) => !o)}
                        title="Account & Settings"
                        className="flex items-center gap-2.5 rounded-full py-1 px-1.5 hover:bg-white/5 transition cursor-pointer"
                    >
                        {profile?.avatar_url ? (
                            <img
                                src={profile.avatar_url}
                                alt={headerLabel}
                                className="w-8 h-8 rounded-full object-cover border border-white/15 shrink-0"
                            />
                        ) : (
                            <div className="w-8 h-8 rounded-full bg-[#22222C] border border-white/15 flex items-center justify-center text-xs font-bold uppercase text-[#FF6B4A] shrink-0">
                                {displayHandle[0]}
                            </div>
                        )}
                        <span className="text-sm font-medium text-zinc-200 hidden lg:inline">
                            {headerLabel}
                        </span>
                    </button>

                    {settingsOpen && (
                        <div className="absolute right-0 top-full mt-2 w-60 bg-[#18181F] border border-white/15 rounded-2xl shadow-2xl overflow-hidden z-50">
                            <div className="px-4 py-3 border-b border-white/10 bg-[#14141A]">
                                <p className="text-xs font-bold text-white truncate">{headerLabel}</p>
                                <p className="text-[11px] text-zinc-400 truncate">@{displayHandle}</p>
                            </div>

                            <div className="p-1.5 space-y-1">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSettingsOpen(false)
                                        navigate('/library')
                                    }}
                                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-zinc-200 hover:bg-[#22222C] transition cursor-pointer text-left"
                                >
                                    <User className="w-3.5 h-3.5 text-[#FF9F43]" />
                                    <span>View Profile</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => {
                                        setSettingsOpen(false)
                                        navigate('/settings')
                                    }}
                                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-zinc-200 hover:bg-[#22222C] transition cursor-pointer text-left"
                                >
                                    <Settings className="w-3.5 h-3.5 text-[#FF6B4A]" />
                                    <span>Settings & Preferences</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => {
                                        toggleTheme()
                                        setSettingsOpen(false)
                                    }}
                                    className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs font-medium text-zinc-200 hover:bg-[#22222C] transition cursor-pointer text-left"
                                >
                                    <span className="flex items-center gap-2.5">
                                        {isLight ? (
                                            <Moon className="w-3.5 h-3.5 text-zinc-300" />
                                        ) : (
                                            <Sun className="w-3.5 h-3.5 text-[#FF9F43]" />
                                        )}
                                        <span>Theme</span>
                                    </span>
                                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/10 text-zinc-200 capitalize">
                                        {prefs.theme}
                                    </span>
                                </button>

                                <button
                                    type="button"
                                    disabled={updatingPrivacy}
                                    onClick={handleToggleWatchedPrivacy}
                                    className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs font-medium text-zinc-200 hover:bg-[#22222C] transition cursor-pointer text-left"
                                >
                                    <span className="flex items-center gap-2.5">
                                        {isFollowersOnly ? (
                                            <Lock className="w-3.5 h-3.5 text-[#FF6B4A]" />
                                        ) : (
                                            <Globe className="w-3.5 h-3.5 text-emerald-400" />
                                        )}
                                        <span>Watched Library</span>
                                    </span>
                                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/10 text-zinc-200">
                                        {isFollowersOnly ? 'Followers' : 'Everyone'}
                                    </span>
                                </button>
                            </div>

                            <div className="p-1.5 border-t border-white/10">
                                <button
                                    type="button"
                                    onClick={async () => {
                                        setSettingsOpen(false)
                                        await signOut()
                                    }}
                                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-red-400 hover:bg-red-500/10 transition cursor-pointer text-left"
                                >
                                    <LogOut className="w-3.5 h-3.5" />
                                    <span>Sign Out</span>
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </header>

            <div className="max-w-[1440px] mx-auto flex">
                <LeftRail
                    watching={watching}
                    notificationCount={notificationCount}
                    onIncrementEpisode={onIncrementEpisode}
                    onSelectMedia={(log) =>
                        onOpenMedia({
                            tmdb_id: log.tmdb_id,
                            media_type: log.media_type,
                            title: log.title,
                            poster_path: log.poster_path,
                        })
                    }
                    onOpenReviewComposer={openReviewComposer}
                />

                <main
                    className={`flex-1 min-w-0 pb-24 md:pb-6 flex justify-center ${
                        isTrailersRoute ? 'px-4 sm:px-6 py-4' : 'px-4 sm:px-6 py-6'
                    }`}
                >
                    <div
                        className={`w-full mx-auto ${
                            isTrailersRoute || isSettingsRoute
                                ? 'max-w-5xl'
                                : isProfileRoute
                                    ? 'max-w-3xl'
                                    : 'max-w-4xl'
                        }`}
                    >
                        <Outlet />
                    </div>
                </main>

                {!hideRightRail && (
                    <RightRail
                        suggestedUsers={visibleSuggestions}
                        outgoingRequestIds={outgoingRequestIds}
                        friendIds={friendIds}
                        joinedForumSlugs={joinedForumSlugs}
                        activeForumSlug={activeForumSlug}
                        onFollowUser={onFollowUser}
                        onJoinOrOpenForum={onJoinOrOpenForum}
                        onLeaveForum={onLeaveForum}
                    />
                )}
            </div>
        </div>
    )
}