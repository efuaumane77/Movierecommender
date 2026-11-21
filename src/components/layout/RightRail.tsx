import { useLocation, useNavigate } from 'react-router-dom'
import { UserPlus, Check, Clock, Sparkles, Hash, MessageSquare } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { GENRE_FORUMS } from '../../lib/forums'
import type { Profile } from '../../types/database'

interface RightRailProps {
    suggestedUsers: Profile[]
    outgoingRequestIds: Set<string>
    friendIds: Set<string>
    joinedForumSlugs: string[]
    activeForumSlug: string | null
    onFollowUser: (targetUserId: string) => Promise<void>
    onJoinOrOpenForum: (slug: string) => void
    onLeaveForum: (slug: string) => void
}

export function RightRail({
                              suggestedUsers,
                              outgoingRequestIds,
                              friendIds,
                              joinedForumSlugs,
                              activeForumSlug,
                              onFollowUser,
                              onJoinOrOpenForum,
                              onLeaveForum,
                          }: RightRailProps) {
    const { profile } = useAuth()
    const location = useLocation()
    const navigate = useNavigate()
    const isMessagesRoute = location.pathname === '/messages'

    return (
        <aside className="hidden xl:flex w-72 2xl:w-80 shrink-0 border-l border-white/10 bg-[#0E0E12] p-4 h-[calc(100dvh-64px)] sticky top-16 flex-col gap-4 overflow-y-auto">
            <div className="bg-[#18181F] border border-white/10 rounded-2xl p-3.5 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#FF6B4A] to-[#FF9F43] flex items-center justify-center font-bold text-sm uppercase text-white shrink-0">
                    {profile?.username?.[0] ?? 'K'}
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-white truncate">@{profile?.username ?? 'user'}</p>
                    <p className="text-[11px] text-zinc-400">
                        {friendIds.size} following • {joinedForumSlugs.length} forums
                    </p>
                </div>
            </div>

            {isMessagesRoute ? (
                <div className="bg-[#18181F] border border-white/10 rounded-2xl p-4 space-y-3.5">
                    <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
              <Hash className="w-3.5 h-3.5 text-[#FF6B4A]" /> Public Genre Forums
            </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 leading-relaxed">
                        Join interest rooms to debate theories, drops, and recommendations with everyone on Cinerate.
                    </p>

                    <div className="space-y-2.5">
                        {GENRE_FORUMS.map((forum) => {
                            const isJoined = joinedForumSlugs.includes(forum.slug)
                            const isOpen = activeForumSlug === forum.slug

                            return (
                                <div
                                    key={forum.slug}
                                    className={`rounded-xl p-2.5 border transition ${
                                        isOpen
                                            ? 'bg-[#22222C] border-[#FF6B4A]/60'
                                            : 'bg-[#14141A] border-white/5 hover:border-white/15'
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onJoinOrOpenForum(forum.slug)
                                                if (location.pathname !== '/messages') navigate('/messages')
                                            }}
                                            className="flex items-start gap-2.5 min-w-0 text-left cursor-pointer group"
                                        >
                      <span className="w-8 h-8 rounded-lg bg-[#22222C] border border-white/10 flex items-center justify-center text-sm shrink-0">
                        {forum.emoji}
                      </span>
                                            <div className="min-w-0">
                                                <p className="text-xs font-bold text-white truncate group-hover:text-[#FF9F43] transition">
                                                    {forum.name}
                                                </p>
                                                <p className="text-[11px] text-zinc-400 line-clamp-2 mt-0.5 leading-snug">
                                                    {forum.tagline}
                                                </p>
                                            </div>
                                        </button>
                                    </div>

                                    <div className="mt-2.5 flex items-center justify-between gap-2">
                                        {isJoined ? (
                                            <>
                                                <button
                                                    type="button"
                                                    onClick={() => onJoinOrOpenForum(forum.slug)}
                                                    className={`flex-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 transition cursor-pointer ${
                                                        isOpen
                                                            ? 'bg-gradient-to-r from-[#FF6B4A] to-[#FF9F43] text-white'
                                                            : 'bg-[#22222C] hover:bg-[#FF6B4A] text-zinc-200 hover:text-white'
                                                    }`}
                                                >
                                                    <MessageSquare className="w-3 h-3" />
                                                    {isOpen ? 'Active Room' : 'Open Chat'}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => onLeaveForum(forum.slug)}
                                                    className="px-2 py-1 rounded-lg text-[10px] text-zinc-500 hover:text-red-400 transition cursor-pointer"
                                                >
                                                    Leave
                                                </button>
                                            </>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => onJoinOrOpenForum(forum.slug)}
                                                className="w-full px-2.5 py-1.5 rounded-lg bg-[#FF6B4A]/15 hover:bg-[#FF6B4A] text-[#FF6B4A] hover:text-white text-[11px] font-semibold flex items-center justify-center gap-1 transition cursor-pointer"
                                            >
                                                <UserPlus className="w-3 h-3" /> Join Forum
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            ) : (
                <div className="bg-[#18181F] border border-white/10 rounded-2xl p-4 space-y-3.5">
                    <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#FF6B4A]" /> Suggested for you
            </span>
                    </div>

                    {suggestedUsers.length === 0 ? (
                        <p className="text-xs text-zinc-500 py-4 text-center">
                            No new suggestions right now — invite friends to join Cinerate!
                        </p>
                    ) : (
                        <div className="space-y-3">
                            {suggestedUsers.map((person) => {
                                const isFriend = friendIds.has(person.id)
                                const isRequested = outgoingRequestIds.has(person.id)

                                return (
                                    <div key={person.id} className="flex items-center justify-between gap-2.5">
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <div className="w-9 h-9 rounded-full bg-[#22222C] border border-white/10 flex items-center justify-center font-bold text-xs uppercase text-[#FF9F43] shrink-0">
                                                {person.username[0]}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-xs font-semibold text-white truncate">@{person.username}</p>
                                                <p className="text-[11px] text-zinc-500 truncate">On Cinerate</p>
                                            </div>
                                        </div>

                                        {isFriend ? (
                                            <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-400 text-[11px] font-semibold flex items-center gap-1 shrink-0">
                        <Check className="w-3 h-3" /> Following
                      </span>
                                        ) : isRequested ? (
                                            <span className="px-2.5 py-1 rounded-lg bg-[#22222C] text-zinc-400 text-[11px] font-semibold flex items-center gap-1 shrink-0">
                        <Clock className="w-3 h-3" /> Requested
                      </span>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => onFollowUser(person.id)}
                                                className="px-3 py-1.5 rounded-lg bg-[#FF6B4A] hover:bg-[#FF9F43] text-white text-xs font-semibold flex items-center gap-1 transition cursor-pointer shrink-0"
                                            >
                                                <UserPlus className="w-3 h-3" /> Follow
                                            </button>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            )}
        </aside>
    )
}