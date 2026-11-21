import { NavLink } from 'react-router-dom'
import {
    Home,
    Clapperboard,
    Send,
    Search,
    Heart,
    PlusSquare,
    LogOut,
    Plus,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { posterUrl } from '../../lib/tmdb'
import type { MediaLog } from '../../types/database'

interface LeftRailProps {
    watching: MediaLog[]
    notificationCount: number
    onIncrementEpisode: (log: MediaLog) => void
    onSelectMedia: (log: MediaLog) => void
    onOpenReviewComposer?: () => void
}

export function LeftRail({
                             watching,
                             notificationCount,
                             onIncrementEpisode,
                             onSelectMedia,
                         }: LeftRailProps) {
    const { profile, signOut } = useAuth()

    const linkClass = ({ isActive }: { isActive: boolean }) =>
        `flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl text-sm transition ${
            isActive
                ? 'bg-gradient-to-r from-[#FF6B4A] to-[#FF9F43] text-white font-bold shadow-lg shadow-[#FF6B4A]/20'
                : 'text-zinc-300 hover:text-white hover:bg-[#18181F] font-medium'
        }`

    return (
        <>
            <aside className="hidden md:flex w-56 lg:w-64 shrink-0 border-r border-white/10 bg-[#0E0E12] flex-col justify-between p-3 lg:p-4 h-[calc(100dvh-64px)] sticky top-16">
                <div className="space-y-6 overflow-y-auto pr-1">
                    <nav className="space-y-1">
                        <NavLink to="/" end className={linkClass}>
                            <Home className="w-5 h-5 shrink-0" />
                            <span>Home</span>
                        </NavLink>

                        <NavLink to="/trailers" className={linkClass}>
                            <Clapperboard className="w-5 h-5 shrink-0" />
                            <span>Trailers</span>
                        </NavLink>

                        <NavLink to="/messages" className={linkClass}>
                            <Send className="w-5 h-5 shrink-0" />
                            <span>Messages</span>
                        </NavLink>

                        <NavLink to="/search" className={linkClass}>
                            <Search className="w-5 h-5 shrink-0" />
                            <span>Search</span>
                        </NavLink>

                        <NavLink to="/notifications" className={linkClass}>
                            <div className="relative shrink-0">
                                <Heart className="w-5 h-5" />
                                {notificationCount > 0 && (
                                    <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-[#FF6B4A] text-white text-[10px] font-bold flex items-center justify-center">
                    {notificationCount}
                  </span>
                                )}
                            </div>
                            <span>Notifications</span>
                        </NavLink>

                        <NavLink to="/reviews" className={linkClass}>
                            <PlusSquare className="w-5 h-5 shrink-0" />
                            <span>Review</span>
                        </NavLink>

                        <NavLink to="/library" className={linkClass}>
                            {profile?.avatar_url ? (
                                <img
                                    src={profile.avatar_url}
                                    alt={profile.username}
                                    className="w-5 h-5 rounded-full object-cover border border-white/25 shrink-0"
                                />
                            ) : (
                                <div className="w-5 h-5 rounded-full bg-[#22222C] border border-white/25 flex items-center justify-center text-[10px] font-bold uppercase shrink-0">
                                    {profile?.username?.[0] ?? 'K'}
                                </div>
                            )}
                            <span>Profile</span>
                        </NavLink>
                    </nav>

                    <div>
                        <div className="flex items-center justify-between px-1 mb-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Currently Watching
              </span>
                            <span className="text-[11px] text-zinc-500">{watching.length}</span>
                        </div>

                        {watching.length === 0 ? (
                            <div className="bg-[#18181F] border border-white/5 rounded-xl p-3 text-xs text-zinc-500">
                                Search a show and mark it <span className="text-zinc-300">Watching</span> to track episodes here.
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {watching.map((item) => (
                                    <div
                                        key={item.id}
                                        className="bg-[#18181F] border border-white/10 rounded-xl p-2 flex items-center gap-2 group"
                                    >
                                        <button
                                            onClick={() => onSelectMedia(item)}
                                            className="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer"
                                        >
                                            {item.poster_path ? (
                                                <img
                                                    src={posterUrl(item.poster_path, 'w185')}
                                                    alt={item.title}
                                                    className="w-8 h-11 rounded-lg object-cover shrink-0"
                                                />
                                            ) : (
                                                <div className="w-8 h-11 rounded-lg bg-[#22222C] shrink-0" />
                                            )}
                                            <div className="min-w-0 flex-1">
                                                <p className="text-xs font-semibold text-zinc-100 truncate group-hover:text-[#FF6B4A] transition">
                                                    {item.title}
                                                </p>
                                                <p className="text-[11px] text-zinc-400 mt-0.5">
                                                    {item.media_type === 'tv' ? `S${item.season}:E${item.episode}` : 'In Progress'}
                                                </p>
                                            </div>
                                        </button>

                                        {item.media_type === 'tv' && (
                                            <button
                                                onClick={() => onIncrementEpisode(item)}
                                                title="Log next episode"
                                                className="px-2 py-1 rounded-lg bg-[#FF6B4A]/15 hover:bg-[#FF6B4A] text-[#FF6B4A] hover:text-white text-xs font-bold transition flex items-center gap-0.5 shrink-0 cursor-pointer"
                                            >
                                                <Plus className="w-3 h-3" />1
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <button
                    onClick={signOut}
                    className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-medium text-zinc-400 hover:text-white hover:bg-[#18181F] transition cursor-pointer mt-4"
                >
                    <LogOut className="w-4 h-4 shrink-0" />
                    Sign Out
                </button>
            </aside>

            <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 h-16 bg-[#18181F]/95 backdrop-blur-md border-t border-white/10 flex items-center justify-around px-1">
                <NavLink
                    to="/"
                    end
                    className={({ isActive }) =>
                        `p-2 rounded-xl ${isActive ? 'text-[#FF6B4A]' : 'text-zinc-400'}`
                    }
                >
                    <Home className="w-5 h-5" />
                </NavLink>
                <NavLink
                    to="/trailers"
                    className={({ isActive }) =>
                        `p-2 rounded-xl ${isActive ? 'text-[#FF6B4A]' : 'text-zinc-400'}`
                    }
                >
                    <Clapperboard className="w-5 h-5" />
                </NavLink>
                <NavLink
                    to="/search"
                    className={({ isActive }) =>
                        `p-2 rounded-xl ${isActive ? 'text-[#FF6B4A]' : 'text-zinc-400'}`
                    }
                >
                    <Search className="w-5 h-5" />
                </NavLink>
                <NavLink
                    to="/reviews"
                    className={({ isActive }) =>
                        `p-2 rounded-xl ${isActive ? 'text-[#FF6B4A]' : 'text-zinc-400'}`
                    }
                >
                    <PlusSquare className="w-5 h-5" />
                </NavLink>
                <NavLink
                    to="/notifications"
                    className={({ isActive }) =>
                        `relative p-2 rounded-xl ${isActive ? 'text-[#FF6B4A]' : 'text-zinc-400'}`
                    }
                >
                    <Heart className="w-5 h-5" />
                    {notificationCount > 0 && (
                        <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#FF6B4A]" />
                    )}
                </NavLink>
                <NavLink
                    to="/messages"
                    className={({ isActive }) =>
                        `p-2 rounded-xl ${isActive ? 'text-[#FF6B4A]' : 'text-zinc-400'}`
                    }
                >
                    <Send className="w-5 h-5" />
                </NavLink>
                <NavLink
                    to="/library"
                    className={({ isActive }) =>
                        `p-2 rounded-xl ${isActive ? 'text-[#FF6B4A]' : 'text-zinc-400'}`
                    }
                >
                    {profile?.avatar_url ? (
                        <img
                            src={profile.avatar_url}
                            alt={profile.username}
                            className="w-5 h-5 rounded-full object-cover border border-white/25"
                        />
                    ) : (
                        <div className="w-5 h-5 rounded-full bg-[#22222C] border border-white/25 flex items-center justify-center text-[10px] font-bold uppercase">
                            {profile?.username?.[0] ?? 'K'}
                        </div>
                    )}
                </NavLink>
            </nav>
        </>
    )
}