import { useCallback, useEffect, useRef, useState } from 'react'
import {
    Send,
    Film,
    Clapperboard,
    MessageSquareText,
    Play,
    Plus,
    Search,
    X,
    MessageSquare,
    Hash,
    Users,
    Star,
    Check,
    CheckCheck,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { getTrending, posterUrl, searchMulti, type TMDBSearchResult } from '../lib/tmdb'
import { GENRE_FORUMS } from '../lib/forums'
import type { MediaLog, Profile } from '../types/database'
import type { SelectedMedia } from '../components/media/MediaModal'
import { TrailerPreviewModal } from '../components/media/TrailerPreviewModal'

export interface DirectMessage {
    id: string
    sender_id: string
    receiver_id: string
    content: string
    attached_tmdb_id: number | null
    attached_media_type: 'movie' | 'tv' | null
    attached_title: string | null
    attached_poster: string | null
    read_at: string | null
    created_at: string
}

export interface ForumMessage {
    id: string
    forum_slug: string
    sender_id: string
    content: string
    attached_tmdb_id: number | null
    attached_media_type: 'movie' | 'tv' | null
    attached_title: string | null
    attached_poster: string | null
    created_at: string
    profiles?: {
        id: string
        username: string
        avatar_url: string | null
    }
}

type AttachTab = 'media' | 'reels' | 'reviews'

interface PendingAttachment {
    kind: AttachTab
    tmdb_id: number
    media_type: 'movie' | 'tv'
    title: string
    poster_path: string | null
    overview?: string
    reviewAuthor?: string
    reviewRating?: number | null
    reviewSnippet?: string
}

interface MessagesPageProps {
    friends: Profile[]
    joinedForumSlugs: string[]
    activeForumSlug: string | null
    onSelectForum: (slug: string | null) => void
    onJoinOrOpenForum: (slug: string) => void
    onOpenMedia?: (media: SelectedMedia) => void
}

const REVIEW_PREFIX = '__REVIEW__::'

interface DecodedReviewPayload {
    author: string
    rating: number | null
    snippet: string
    note: string
}

function encodeAttachmentContent(draft: string, attachment: PendingAttachment | null): string {
    const cleanDraft = draft.trim()
    if (!attachment) return cleanDraft

    if (attachment.kind === 'reviews') {
        const payload: DecodedReviewPayload = {
            author: attachment.reviewAuthor ?? 'user',
            rating: attachment.reviewRating ?? null,
            snippet: attachment.reviewSnippet ?? '',
            note: cleanDraft,
        }
        return `${REVIEW_PREFIX}${JSON.stringify(payload)}`
    }

    if (cleanDraft) return cleanDraft
    return attachment.kind === 'reels'
        ? `Watch this trailer reel: ${attachment.title}`
        : `Check out ${attachment.title}!`
}

function parseReviewPayload(content: string): DecodedReviewPayload | null {
    if (!content.startsWith(REVIEW_PREFIX)) return null
    try {
        return JSON.parse(content.slice(REVIEW_PREFIX.length)) as DecodedReviewPayload
    } catch {
        return null
    }
}

function formatMessageTime(iso: string): string {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function MessagesPage({
                                 friends,
                                 joinedForumSlugs,
                                 activeForumSlug,
                                 onSelectForum,
                                 onJoinOrOpenForum,
                                 onOpenMedia,
                             }: MessagesPageProps) {
    const { user, profile } = useAuth()
    const [selectedFriendId, setSelectedFriendId] = useState<string | null>(
        activeForumSlug ? null : friends[0]?.id ?? null
    )
    const [dmMessages, setDmMessages] = useState<DirectMessage[]>([])
    const [forumMessages, setForumMessages] = useState<ForumMessage[]>([])
    const [unreadByFriend, setUnreadByFriend] = useState<Record<string, number>>({})
    const [loadingThread, setLoadingThread] = useState(false)
    const [draft, setDraft] = useState('')
    const [sending, setSending] = useState(false)
    const [sendError, setSendError] = useState<string | null>(null)

    const [animatedIds, setAnimatedIds] = useState<Set<string>>(new Set())

    const [typingUsers, setTypingUsers] = useState<Record<string, string>>({})
    const activeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
    const lastTypingSentRef = useRef<number>(0)

    const [attachOpen, setAttachOpen] = useState(false)
    const [attachTab, setAttachTab] = useState<AttachTab>('media')
    const [attachQuery, setAttachQuery] = useState('')
    const [mediaHits, setMediaHits] = useState<TMDBSearchResult[]>([])
    const [trendingReels, setTrendingReels] = useState<TMDBSearchResult[]>([])
    const [shareableReviews, setShareableReviews] = useState<MediaLog[]>([])
    const [searchingAttach, setSearchingAttach] = useState(false)
    const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null)

    const [previewMedia, setPreviewMedia] = useState<SelectedMedia | null>(null)
    const bottomRef = useRef<HTMLDivElement | null>(null)

    const activeForum = activeForumSlug
        ? GENRE_FORUMS.find((f) => f.slug === activeForumSlug) ?? null
        : null
    const selectedFriend = !activeForum
        ? friends.find((f) => f.id === selectedFriendId) ?? null
        : null

    const joinedForums = GENRE_FORUMS.filter((f) => joinedForumSlugs.includes(f.slug))

    useEffect(() => {
        const allCurrentIds = [
            ...forumMessages.map((m) => m.id),
            ...dmMessages.map((m) => m.id),
        ]
        if (allCurrentIds.length === 0) return

        const timer = setTimeout(() => {
            setAnimatedIds((prev) => {
                const next = new Set(prev)
                for (const id of allCurrentIds) next.add(id)
                return next
            })
        }, 400)

        return () => clearTimeout(timer)
    }, [forumMessages, dmMessages])

    useEffect(() => {
        if (!user) return
        Promise.resolve(
            supabase
                .from('messages')
                .select('sender_id')
                .eq('receiver_id', user.id)
                .is('read_at', null)
        ).then(({ data }) => {
            if (!data) return
            const counts: Record<string, number> = {}
            for (const row of data as { sender_id: string }[]) {
                counts[row.sender_id] = (counts[row.sender_id] ?? 0) + 1
            }
            setUnreadByFriend(counts)
        })
    }, [user])

    const markThreadAsRead = useCallback(
        async (friendId: string) => {
            if (!user) return
            const nowIso = new Date().toISOString()

            setUnreadByFriend((prev) => {
                if (!prev[friendId]) return prev
                const next = { ...prev }
                delete next[friendId]
                return next
            })

            setDmMessages((prev) =>
                prev.map((m) =>
                    m.sender_id === friendId && m.receiver_id === user.id && !m.read_at
                        ? { ...m, read_at: nowIso }
                        : m
                )
            )

            await supabase
                .from('messages')
                .update({ read_at: nowIso })
                .eq('sender_id', friendId)
                .eq('receiver_id', user.id)
                .is('read_at', null)
        },
        [user]
    )

    useEffect(() => {
        if (!user || !selectedFriendId || activeForumSlug) return

        let cancelled = false
        Promise.resolve().then(() => {
            if (!cancelled) setLoadingThread(true)
        })

        Promise.resolve(
            supabase
                .from('messages')
                .select('*')
                .or(
                    `and(sender_id.eq.${user.id},receiver_id.eq.${selectedFriendId}),and(sender_id.eq.${selectedFriendId},receiver_id.eq.${user.id})`
                )
                .order('created_at', { ascending: true })
                .limit(100)
        )
            .then(({ data, error }) => {
                if (cancelled) return
                if (!error && data) {
                    const loaded = data as DirectMessage[]
                    setDmMessages(loaded)
                    void markThreadAsRead(selectedFriendId)
                }
            })
            .finally(() => {
                if (!cancelled) setLoadingThread(false)
            })

        return () => {
            cancelled = true
        }
    }, [user, selectedFriendId, activeForumSlug, markThreadAsRead])

    useEffect(() => {
        if (!user || !activeForumSlug) return

        let cancelled = false
        Promise.resolve().then(() => {
            if (!cancelled) setLoadingThread(true)
        })

        Promise.resolve(
            supabase
                .from('forum_messages')
                .select('*, profiles(id, username, avatar_url)')
                .eq('forum_slug', activeForumSlug)
                .order('created_at', { ascending: true })
                .limit(120)
        )
            .then(({ data, error }) => {
                if (cancelled) return
                if (!error && data) {
                    const loaded = data as ForumMessage[]
                    setForumMessages(loaded)
                }
            })
            .finally(() => {
                if (!cancelled) setLoadingThread(false)
            })

        return () => {
            cancelled = true
        }
    }, [user, activeForumSlug])

    useEffect(() => {
        if (!user) return

        const roomTopic =
            selectedFriendId && !activeForumSlug
                ? `dm-room-${[user.id, selectedFriendId].sort().join('-')}`
                : `dm-global-${user.id}`

        const channel = supabase
            .channel(roomTopic)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'messages' },
                (payload) => {
                    const incoming = payload.new as DirectMessage
                    const involvesMe =
                        incoming.sender_id === user.id || incoming.receiver_id === user.id
                    if (!involvesMe) return

                    setTypingUsers((prev) => {
                        if (!prev[incoming.sender_id]) return prev
                        const next = { ...prev }
                        delete next[incoming.sender_id]
                        return next
                    })

                    if (
                        selectedFriendId &&
                        !activeForumSlug &&
                        (incoming.sender_id === selectedFriendId ||
                            incoming.receiver_id === selectedFriendId)
                    ) {
                        setDmMessages((prev) =>
                            prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]
                        )
                        if (incoming.sender_id === selectedFriendId) {
                            void markThreadAsRead(selectedFriendId)
                        }
                    } else if (incoming.receiver_id === user.id) {
                        setUnreadByFriend((prev) => ({
                            ...prev,
                            [incoming.sender_id]: (prev[incoming.sender_id] ?? 0) + 1,
                        }))
                    }
                }
            )
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'messages' },
                (payload) => {
                    const updated = payload.new as DirectMessage
                    if (updated.sender_id !== user.id && updated.receiver_id !== user.id) return
                    setDmMessages((prev) =>
                        prev.map((m) => (m.id === updated.id ? { ...m, read_at: updated.read_at } : m))
                    )
                }
            )
            .on('broadcast', { event: 'typing' }, ({ payload }) => {
                const { userId, username, isTyping } = payload as {
                    userId: string
                    username: string
                    isTyping: boolean
                }
                if (!userId || userId === user.id) return
                setTypingUsers((prev) => {
                    const next = { ...prev }
                    if (isTyping) next[userId] = username || 'Someone'
                    else delete next[userId]
                    return next
                })
            })
            .subscribe()

        if (selectedFriendId && !activeForumSlug) {
            activeChannelRef.current = channel
        }

        return () => {
            if (activeChannelRef.current === channel) {
                activeChannelRef.current = null
            }
            supabase.removeChannel(channel)
        }
    }, [user, selectedFriendId, activeForumSlug, markThreadAsRead])

    useEffect(() => {
        if (!user || !activeForumSlug) return

        const channel = supabase
            .channel(`forum-room-${activeForumSlug}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'forum_messages',
                    filter: `forum_slug=eq.${activeForumSlug}`,
                },
                async (payload) => {
                    const raw = payload.new as ForumMessage

                    setTypingUsers((prev) => {
                        if (!prev[raw.sender_id]) return prev
                        const next = { ...prev }
                        delete next[raw.sender_id]
                        return next
                    })

                    const { data: senderProfile } = await supabase
                        .from('profiles')
                        .select('id, username, avatar_url')
                        .eq('id', raw.sender_id)
                        .single()

                    const enriched: ForumMessage = {
                        ...raw,
                        profiles: senderProfile ?? undefined,
                    }

                    setForumMessages((prev) =>
                        prev.some((m) => m.id === enriched.id) ? prev : [...prev, enriched]
                    )
                }
            )
            .on('broadcast', { event: 'typing' }, ({ payload }) => {
                const { userId, username, isTyping } = payload as {
                    userId: string
                    username: string
                    isTyping: boolean
                }
                if (!userId || userId === user.id) return
                setTypingUsers((prev) => {
                    const next = { ...prev }
                    if (isTyping) next[userId] = username || 'Someone'
                    else delete next[userId]
                    return next
                })
            })
            .subscribe()

        activeChannelRef.current = channel

        return () => {
            if (activeChannelRef.current === channel) {
                activeChannelRef.current = null
            }
            supabase.removeChannel(channel)
        }
    }, [user, activeForumSlug])

    useEffect(() => {
        if (!user || !activeChannelRef.current) return
        const isTyping = draft.trim().length > 0
        const now = Date.now()

        if (isTyping && now - lastTypingSentRef.current < 1200) return
        lastTypingSentRef.current = now

        activeChannelRef.current.send({
            type: 'broadcast',
            event: 'typing',
            payload: {
                userId: user.id,
                username: profile?.username ?? user.email?.split('@')[0] ?? 'user',
                isTyping,
            },
        })
    }, [draft, user, profile?.username])

    const typingNames = Object.values(typingUsers)
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [dmMessages.length, forumMessages.length, typingNames.length, selectedFriendId, activeForumSlug])

    useEffect(() => {
        if (!attachOpen) return
        let cancelled = false

        if (trendingReels.length === 0) {
            getTrending(1)
                .then((res) => {
                    if (!cancelled) setTrendingReels(res.slice(0, 8))
                })
                .catch(console.error)
        }

        Promise.resolve(
            supabase
                .from('media_logs')
                .select('*, profiles(id, username, avatar_url, created_at)')
                .not('review_text', 'is', null)
                .neq('review_text', '')
                .order('updated_at', { ascending: false })
                .limit(12)
        ).then(({ data }) => {
            if (!cancelled && data) {
                setShareableReviews(data as MediaLog[])
            }
        })

        return () => {
            cancelled = true
        }
    }, [attachOpen, trendingReels.length])

    useEffect(() => {
        if (!attachOpen || attachTab === 'reviews' || !attachQuery.trim()) return

        let cancelled = false
        const timer = setTimeout(async () => {
            setSearchingAttach(true)
            try {
                const results = await searchMulti(attachQuery)
                if (!cancelled) setMediaHits(results.slice(0, 6))
            } catch (err) {
                console.error(err)
            } finally {
                if (!cancelled) setSearchingAttach(false)
            }
        }, 260)

        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [attachOpen, attachTab, attachQuery])

    async function handleSendMessage(e: React.FormEvent) {
        e.preventDefault()
        setSendError(null)
        if (!user) return
        if (!draft.trim() && !pendingAttachment) return

        const contentText = encodeAttachmentContent(draft, pendingAttachment)
        setSending(true)

        if (activeForum) {
            const { data, error } = await supabase
                .from('forum_messages')
                .insert({
                    forum_slug: activeForum.slug,
                    sender_id: user.id,
                    content: contentText,
                    attached_tmdb_id: pendingAttachment?.tmdb_id ?? null,
                    attached_media_type: pendingAttachment?.media_type ?? null,
                    attached_title: pendingAttachment?.title ?? null,
                    attached_poster: pendingAttachment?.poster_path ?? null,
                })
                .select('*')
                .single()

            setSending(false)

            if (error) {
                setSendError(error.message)
                return
            }

            if (data) {
                const inserted: ForumMessage = {
                    ...(data as ForumMessage),
                    profiles: profile
                        ? { id: profile.id, username: profile.username, avatar_url: profile.avatar_url }
                        : undefined,
                }
                setForumMessages((prev) =>
                    prev.some((m) => m.id === inserted.id) ? prev : [...prev, inserted]
                )
                setDraft('')
                setPendingAttachment(null)
                setAttachOpen(false)
                setAttachQuery('')
            }
            return
        }

        if (!selectedFriendId) {
            setSending(false)
            return
        }

        const { data, error } = await supabase
            .from('messages')
            .insert({
                sender_id: user.id,
                receiver_id: selectedFriendId,
                content: contentText,
                attached_tmdb_id: pendingAttachment?.tmdb_id ?? null,
                attached_media_type: pendingAttachment?.media_type ?? null,
                attached_title: pendingAttachment?.title ?? null,
                attached_poster: pendingAttachment?.poster_path ?? null,
            })
            .select('*')
            .single()

        setSending(false)

        if (error) {
            setSendError(error.message)
            return
        }

        if (data) {
            const inserted = data as DirectMessage
            setDmMessages((prev) =>
                prev.some((m) => m.id === inserted.id) ? prev : [...prev, inserted]
            )
            setDraft('')
            setPendingAttachment(null)
            setAttachOpen(false)
            setAttachQuery('')
        }
    }

    function renderBubbleBody(
        msg: {
            content: string
            attached_tmdb_id: number | null
            attached_media_type: 'movie' | 'tv' | null
            attached_title: string | null
            attached_poster: string | null
        },
        isMine: boolean
    ) {
        const hasAttachment =
            msg.attached_tmdb_id !== null &&
            msg.attached_media_type !== null &&
            msg.attached_title !== null
        const decodedReview = parseReviewPayload(msg.content)

        return (
            <>
                {hasAttachment && (
                    <div
                        onClick={() =>
                            setPreviewMedia({
                                tmdb_id: msg.attached_tmdb_id!,
                                media_type: msg.attached_media_type!,
                                title: msg.attached_title!,
                                poster_path: msg.attached_poster,
                            })
                        }
                        className={`rounded-xl p-2.5 flex items-start gap-2.5 cursor-pointer transition ${
                            isMine
                                ? 'bg-black/25 hover:bg-black/35'
                                : 'bg-[#18181F] hover:bg-[#14141A] border border-white/10'
                        }`}
                    >
                        {msg.attached_poster ? (
                            <img
                                src={posterUrl(msg.attached_poster, 'w185')}
                                alt={msg.attached_title!}
                                className="w-10 h-14 rounded-lg object-cover shrink-0"
                            />
                        ) : (
                            <div className="w-10 h-14 rounded-lg bg-black/40 flex items-center justify-center shrink-0">
                                <Film className="w-4 h-4 text-zinc-400" />
                            </div>
                        )}

                        <div className="min-w-0 flex-1">
                            {decodedReview ? (
                                <>
                                    <div className="flex items-center justify-between gap-2">
                    <span
                        className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ${
                            isMine ? 'text-white/85' : 'text-[#FF9F43]'
                        }`}
                    >
                      <MessageSquareText className="w-2.5 h-2.5" /> @{decodedReview.author}'s Review
                    </span>
                                        {decodedReview.rating !== null && (
                                            <span
                                                className={`text-[10px] font-bold flex items-center gap-0.5 shrink-0 ${
                                                    isMine ? 'text-white' : 'text-[#FF9F43]'
                                                }`}
                                            >
                        <Star className="w-2.5 h-2.5 fill-current" /> {decodedReview.rating}/5
                      </span>
                                        )}
                                    </div>
                                    <p className="text-xs font-bold truncate mt-0.5">{msg.attached_title}</p>
                                    <p
                                        className={`text-[11px] italic line-clamp-2 mt-1 ${
                                            isMine ? 'text-white/90' : 'text-zinc-300'
                                        }`}
                                    >
                                        “{decodedReview.snippet}”
                                    </p>
                                </>
                            ) : (
                                <>
                  <span
                      className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ${
                          isMine ? 'text-white/80' : 'text-[#FF9F43]'
                      }`}
                  >
                    <Play className="w-2.5 h-2.5 fill-current" /> Watch Trailer / Reel
                  </span>
                                    <p className="text-xs font-bold truncate mt-0.5">{msg.attached_title}</p>
                                    <p className={`text-[10px] ${isMine ? 'text-white/75' : 'text-zinc-400'}`}>
                                        {msg.attached_media_type === 'tv' ? 'TV Series' : 'Movie'}
                                    </p>
                                </>
                            )}
                        </div>
                    </div>
                )}

                {decodedReview ? (
                    decodedReview.note && (
                        <p className="text-xs leading-relaxed break-words">{decodedReview.note}</p>
                    )
                ) : (
                    msg.content && (
                        <p className="text-xs leading-relaxed break-words">{msg.content}</p>
                    )
                )}
            </>
        )
    }

    const filteredReviews = shareableReviews.filter((r) => {
        if (!attachQuery.trim()) return true
        const q = attachQuery.toLowerCase()
        return (
            r.title.toLowerCase().includes(q) ||
            (r.review_text ?? '').toLowerCase().includes(q) ||
            (r.profiles?.username ?? '').toLowerCase().includes(q)
        )
    })

    const activeMediaList = attachQuery.trim() ? mediaHits : trendingReels
    const lastMyDmId = [...dmMessages].reverse().find((m) => m.sender_id === user?.id)?.id

    return (
        <div className="h-[calc(100dvh-112px)] bg-[#18181F] border border-white/10 rounded-2xl overflow-hidden flex">
            <aside className="w-24 sm:w-64 border-r border-white/10 bg-[#14141A] flex flex-col shrink-0">
                <div className="p-3.5 border-b border-white/10">
                    <h1 className="text-sm font-bold text-white flex items-center gap-2">
                        <MessageSquare className="w-4 h-4 text-[#FF6B4A] shrink-0" />
                        <span className="hidden sm:inline">Inbox & Forums</span>
                    </h1>
                    <p className="text-[11px] text-zinc-500 hidden sm:block mt-0.5">
                        {joinedForums.length} forums • {friends.length} friends
                    </p>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-4">
                    <div className="space-y-1">
                        <p className="hidden sm:flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500 px-2 pb-1">
                            <Hash className="w-3 h-3 text-[#FF9F43]" /> Joined Forums
                        </p>

                        {joinedForums.length === 0 ? (
                            <p className="text-[11px] text-zinc-500 px-2 py-1 hidden sm:block">
                                Join a genre forum on the right →
                            </p>
                        ) : (
                            joinedForums.map((forum) => {
                                const isSelected = activeForumSlug === forum.slug
                                return (
                                    <button
                                        key={forum.slug}
                                        type="button"
                                        onClick={() => {
                                            onSelectForum(forum.slug)
                                            setSelectedFriendId(null)
                                            setDmMessages([])
                                            setTypingUsers({})
                                            setPendingAttachment(null)
                                            setAttachOpen(false)
                                        }}
                                        className={`w-full flex items-center justify-center sm:justify-start gap-2.5 px-2.5 py-2 rounded-xl transition cursor-pointer ${
                                            isSelected
                                                ? 'bg-gradient-to-r from-[#FF6B4A]/20 to-[#FF9F43]/20 border border-[#FF6B4A]/40 text-white'
                                                : 'hover:bg-[#1E1E27] text-zinc-300'
                                        }`}
                                    >
                    <span className="w-9 h-9 rounded-xl bg-[#22222C] border border-white/10 flex items-center justify-center text-sm shrink-0">
                      {forum.emoji}
                    </span>
                                        <div className="hidden sm:block min-w-0 text-left">
                                            <p className="text-xs font-bold truncate">{forum.name}</p>
                                            <p className="text-[10px] text-[#FF9F43] truncate">Public Group</p>
                                        </div>
                                    </button>
                                )
                            })
                        )}
                    </div>

                    <div className="space-y-1">
                        <p className="hidden sm:flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500 px-2 pb-1">
                            <Users className="w-3 h-3 text-[#FF6B4A]" /> Direct Messages
                        </p>

                        {friends.length === 0 ? (
                            <p className="text-[11px] text-zinc-500 px-2 py-1 hidden sm:block">
                                Follow friends to DM directly.
                            </p>
                        ) : (
                            friends.map((friend) => {
                                const active = !activeForumSlug && friend.id === selectedFriendId
                                const unreadCount = unreadByFriend[friend.id] ?? 0
                                return (
                                    <button
                                        key={friend.id}
                                        type="button"
                                        onClick={() => {
                                            onSelectForum(null)
                                            setSelectedFriendId(friend.id)
                                            setForumMessages([])
                                            setTypingUsers({})
                                            setPendingAttachment(null)
                                            setAttachOpen(false)
                                        }}
                                        className={`w-full flex items-center justify-center sm:justify-between gap-2.5 px-2.5 py-2 rounded-xl transition cursor-pointer ${
                                            active
                                                ? 'bg-gradient-to-r from-[#FF6B4A]/20 to-[#FF9F43]/20 border border-[#FF6B4A]/40 text-white'
                                                : 'hover:bg-[#1E1E27] text-zinc-300'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <div className="relative w-9 h-9 rounded-full bg-gradient-to-br from-[#FF6B4A] to-[#FF9F43] flex items-center justify-center font-bold text-xs uppercase text-white shrink-0">
                                                {friend.username[0]}
                                                {unreadCount > 0 && (
                                                    <span className="sm:hidden absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#FF6B4A] border border-[#14141A] text-[9px] font-bold flex items-center justify-center">
                            {unreadCount}
                          </span>
                                                )}
                                            </div>
                                            <div className="hidden sm:block min-w-0 text-left">
                                                <p className="text-xs font-bold truncate">@{friend.username}</p>
                                                <p className="text-[11px] text-zinc-400 truncate">
                                                    {unreadCount > 0 ? `${unreadCount} unread` : 'Tap to chat'}
                                                </p>
                                            </div>
                                        </div>

                                        {unreadCount > 0 && (
                                            <span className="hidden sm:flex min-w-[20px] h-5 px-1.5 rounded-full bg-[#FF6B4A] text-white text-[10px] font-bold items-center justify-center shrink-0">
                        {unreadCount}
                      </span>
                                        )}
                                    </button>
                                )
                            })
                        )}
                    </div>
                </div>
            </aside>

            <section className="flex-1 min-w-0 flex flex-col bg-[#18181F]">
                <div className="xl:hidden px-3 py-2 bg-[#14141A] border-b border-white/10 flex items-center gap-1.5 overflow-x-auto shrink-0">
                    {GENRE_FORUMS.map((forum) => {
                        const active = activeForumSlug === forum.slug
                        return (
                            <button
                                key={forum.slug}
                                type="button"
                                onClick={() => {
                                    setSelectedFriendId(null)
                                    setDmMessages([])
                                    onJoinOrOpenForum(forum.slug)
                                }}
                                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 shrink-0 transition cursor-pointer ${
                                    active
                                        ? 'bg-gradient-to-r from-[#FF6B4A] to-[#FF9F43] text-white'
                                        : 'bg-[#22222C] text-zinc-300'
                                }`}
                            >
                                <span>{forum.emoji}</span>
                                <span>{forum.name.split(' ')[0]}</span>
                            </button>
                        )
                    })}
                </div>

                {!activeForum && !selectedFriend ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-2">
                        <Send className="w-7 h-7 text-zinc-500" />
                        <p className="text-sm font-semibold text-zinc-200">Join a Forum or Start a Chat</p>
                        <p className="text-xs text-zinc-400 max-w-xs">
                            Pick a public genre forum on the right (Horror, Superheroes, Sci-Fi) or select a friend to chat.
                        </p>
                    </div>
                ) : (
                    <>
                        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3 shrink-0">
                            {activeForum ? (
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-9 h-9 rounded-xl bg-[#22222C] border border-white/10 flex items-center justify-center text-base shrink-0">
                                        {activeForum.emoji}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <p className="text-sm font-bold text-white truncate">{activeForum.name}</p>
                                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#FF6B4A]/20 text-[#FF9F43] shrink-0">
                        Public Forum
                      </span>
                                        </div>
                                        <p className="text-[11px] text-zinc-400 truncate">
                                            {typingNames.length > 0
                                                ? `@${typingNames[0]} is typing...`
                                                : activeForum.tagline}
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#FF6B4A] to-[#FF9F43] flex items-center justify-center font-bold text-xs uppercase text-white shrink-0">
                                        {selectedFriend!.username[0]}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-sm font-bold text-white truncate">
                                            @{selectedFriend!.username}
                                        </p>
                                        <p className="text-[11px] text-zinc-400">
                                            {typingNames.length > 0 ? (
                                                <span className="text-[#FF9F43] font-medium">Typing...</span>
                                            ) : (
                                                'Direct Message'
                                            )}
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 space-y-3">
                            {loadingThread ? (
                                <p className="text-xs text-zinc-400 text-center py-6">Loading messages...</p>
                            ) : activeForum ? (
                                forumMessages.length === 0 ? (
                                    <div className="text-center py-10 space-y-1">
                                        <p className="text-xs font-semibold text-zinc-300">
                                            Welcome to {activeForum.name} {activeForum.emoji}
                                        </p>
                                        <p className="text-[11px] text-zinc-500">
                                            Send a message or attach a movie, reel, or review for the group!
                                        </p>
                                    </div>
                                ) : (
                                    forumMessages.map((msg) => {
                                        const isMine = msg.sender_id === user?.id
                                        const senderName = isMine
                                            ? profile?.username ?? 'you'
                                            : msg.profiles?.username ?? 'member'
                                        const isNewMessage = !animatedIds.has(msg.id)

                                        return (
                                            <div
                                                key={msg.id}
                                                className={`flex flex-col ${
                                                    isMine ? 'items-end' : 'items-start'
                                                } ${isNewMessage ? 'animate-imessage-in' : ''}`}
                                            >
                                                {!isMine && (
                                                    <span className="text-[11px] font-semibold text-[#FF9F43] mb-1 px-1">
                            @{senderName}
                          </span>
                                                )}

                                                <div
                                                    className={`max-w-[82%] sm:max-w-[70%] rounded-2xl px-3.5 py-2.5 space-y-2 ${
                                                        isMine
                                                            ? 'bg-gradient-to-br from-[#FF6B4A] to-[#FF9F43] text-white rounded-br-sm'
                                                            : 'bg-[#22222C] border border-white/10 text-zinc-100 rounded-bl-sm'
                                                    }`}
                                                >
                                                    {renderBubbleBody(msg, isMine)}
                                                </div>

                                                <span className="text-[10px] text-zinc-500 mt-1 px-1">
                          {formatMessageTime(msg.created_at)}
                        </span>
                                            </div>
                                        )
                                    })
                                )
                            ) : dmMessages.length === 0 ? (
                                <div className="text-center py-10 space-y-1">
                                    <p className="text-xs font-semibold text-zinc-300">
                                        Say hi to @{selectedFriend!.username}!
                                    </p>
                                    <p className="text-[11px] text-zinc-500">
                                        Send a message or attach a movie, trailer reel, or review.
                                    </p>
                                </div>
                            ) : (
                                dmMessages.map((msg) => {
                                    const isMine = msg.sender_id === user?.id
                                    const isLastSentByMe = msg.id === lastMyDmId
                                    const isNewMessage = !animatedIds.has(msg.id)

                                    return (
                                        <div
                                            key={msg.id}
                                            className={`flex flex-col ${
                                                isMine ? 'items-end' : 'items-start'
                                            } ${isNewMessage ? 'animate-imessage-in' : ''}`}
                                        >
                                            <div
                                                className={`max-w-[82%] sm:max-w-[70%] rounded-2xl px-3.5 py-2.5 space-y-2 ${
                                                    isMine
                                                        ? 'bg-gradient-to-br from-[#FF6B4A] to-[#FF9F43] text-white rounded-br-sm'
                                                        : 'bg-[#22222C] border border-white/10 text-zinc-100 rounded-bl-sm'
                                                }`}
                                            >
                                                {renderBubbleBody(msg, isMine)}
                                            </div>

                                            <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 mt-1 px-1">
                                                <span>{formatMessageTime(msg.created_at)}</span>
                                                {isMine &&
                                                    isLastSentByMe &&
                                                    (msg.read_at ? (
                                                        <span className="text-[#FF9F43] font-semibold flex items-center gap-0.5">
                              <CheckCheck className="w-3 h-3" /> Seen
                            </span>
                                                    ) : (
                                                        <span className="text-zinc-500 flex items-center gap-0.5">
                              <Check className="w-3 h-3" /> Delivered
                            </span>
                                                    ))}
                                            </div>
                                        </div>
                                    )
                                })
                            )}

                            {typingNames.length > 0 && (
                                <div className="flex flex-col items-start animate-imessage-in">
                  <span className="text-[10px] text-zinc-400 mb-1 px-1">
                    @{typingNames[0]} is typing
                  </span>
                                    <div className="bg-[#22222C] border border-white/10 rounded-2xl rounded-bl-sm px-3.5 py-2.5 flex items-center gap-1">
                                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:-0.3s]" />
                                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:-0.15s]" />
                                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce" />
                                    </div>
                                </div>
                            )}

                            <div ref={bottomRef} />
                        </div>

                        {attachOpen && (
                            <div className="px-4 py-3 bg-[#14141A] border-t border-white/10 space-y-2.5">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5">
                                        <button
                                            type="button"
                                            onClick={() => setAttachTab('media')}
                                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition cursor-pointer ${
                                                attachTab === 'media'
                                                    ? 'bg-[#FF6B4A] text-white'
                                                    : 'bg-[#22222C] text-zinc-300 hover:text-white'
                                            }`}
                                        >
                                            <Film className="w-3 h-3" /> Movies & TV
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => setAttachTab('reels')}
                                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition cursor-pointer ${
                                                attachTab === 'reels'
                                                    ? 'bg-[#FF6B4A] text-white'
                                                    : 'bg-[#22222C] text-zinc-300 hover:text-white'
                                            }`}
                                        >
                                            <Clapperboard className="w-3 h-3" /> Reels
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => setAttachTab('reviews')}
                                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition cursor-pointer ${
                                                attachTab === 'reviews'
                                                    ? 'bg-[#FF6B4A] text-white'
                                                    : 'bg-[#22222C] text-zinc-300 hover:text-white'
                                            }`}
                                        >
                                            <MessageSquareText className="w-3 h-3" /> Reviews
                                        </button>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={() => setAttachOpen(false)}
                                        className="text-zinc-400 hover:text-white cursor-pointer p-1"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>

                                <div className="relative">
                                    <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                    <input
                                        type="text"
                                        value={attachQuery}
                                        onChange={(e) => {
                                            const next = e.target.value
                                            setAttachQuery(next)
                                            if (!next.trim()) setMediaHits([])
                                        }}
                                        placeholder={
                                            attachTab === 'reviews'
                                                ? 'Filter reviews by title, @user, or keyword...'
                                                : attachTab === 'reels'
                                                    ? 'Search trailer reels...'
                                                    : 'Search movies or TV shows...'
                                        }
                                        className="w-full bg-[#22222C] border border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-[#FF6B4A]"
                                    />
                                </div>

                                {attachTab === 'reviews' ? (
                                    <div className="max-h-44 overflow-y-auto space-y-1.5">
                                        {filteredReviews.length === 0 ? (
                                            <p className="text-[11px] text-zinc-500 py-2">
                                                No reviews found to attach.
                                            </p>
                                        ) : (
                                            filteredReviews.map((rev) => (
                                                <button
                                                    key={rev.id}
                                                    type="button"
                                                    onClick={() => {
                                                        setPendingAttachment({
                                                            kind: 'reviews',
                                                            tmdb_id: rev.tmdb_id,
                                                            media_type: rev.media_type,
                                                            title: rev.title,
                                                            poster_path: rev.poster_path,
                                                            reviewAuthor: rev.profiles?.username ?? 'user',
                                                            reviewRating: rev.rating,
                                                            reviewSnippet: rev.review_text ?? '',
                                                        })
                                                        setAttachOpen(false)
                                                        setAttachQuery('')
                                                    }}
                                                    className="w-full flex items-start gap-2.5 p-2 rounded-xl hover:bg-[#22222C] text-left transition cursor-pointer"
                                                >
                                                    {rev.poster_path ? (
                                                        <img
                                                            src={posterUrl(rev.poster_path, 'w185')}
                                                            alt={rev.title}
                                                            className="w-7 h-10 rounded object-cover shrink-0"
                                                        />
                                                    ) : (
                                                        <div className="w-7 h-10 rounded bg-[#22222C] shrink-0" />
                                                    )}
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center justify-between gap-2">
                                                            <p className="text-xs font-bold text-white truncate">
                                                                {rev.title}{' '}
                                                                <span className="font-normal text-zinc-400">
                                  by @{rev.profiles?.username ?? 'user'}
                                </span>
                                                            </p>
                                                            {rev.rating !== null && (
                                                                <span className="text-[10px] font-bold text-[#FF9F43] shrink-0">
                                  ★ {rev.rating}/5
                                </span>
                                                            )}
                                                        </div>
                                                        <p className="text-[11px] text-zinc-400 line-clamp-1 mt-0.5">
                                                            “{rev.review_text}”
                                                        </p>
                                                    </div>
                                                    <span className="text-[10px] font-semibold text-[#FF9F43] flex items-center gap-0.5 shrink-0 self-center">
                            <Plus className="w-3 h-3" /> Share
                          </span>
                                                </button>
                                            ))
                                        )}
                                    </div>
                                ) : searchingAttach ? (
                                    <p className="text-[11px] text-zinc-400">Searching...</p>
                                ) : (
                                    <div className="max-h-44 overflow-y-auto space-y-1">
                                        {activeMediaList.map((hit) => {
                                            const title = hit.title || hit.name || 'Untitled'
                                            const year = (hit.release_date || hit.first_air_date || '').slice(0, 4)
                                            return (
                                                <button
                                                    key={`${hit.media_type}-${hit.id}`}
                                                    type="button"
                                                    onClick={() => {
                                                        setPendingAttachment({
                                                            kind: attachTab,
                                                            tmdb_id: hit.id,
                                                            media_type: hit.media_type,
                                                            title,
                                                            poster_path: hit.poster_path,
                                                            overview: hit.overview,
                                                        })
                                                        setAttachOpen(false)
                                                        setAttachQuery('')
                                                        setMediaHits([])
                                                    }}
                                                    className="w-full flex items-center gap-2.5 p-1.5 rounded-xl hover:bg-[#22222C] text-left transition cursor-pointer"
                                                >
                                                    {hit.poster_path ? (
                                                        <img
                                                            src={posterUrl(hit.poster_path, 'w185')}
                                                            alt={title}
                                                            className="w-7 h-10 rounded object-cover shrink-0"
                                                        />
                                                    ) : (
                                                        <div className="w-7 h-10 rounded bg-[#22222C] shrink-0" />
                                                    )}
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-xs font-semibold text-white truncate">{title}</p>
                                                        <p className="text-[10px] text-zinc-400">
                                                            {hit.media_type === 'tv' ? 'TV Series' : 'Movie'}
                                                            {year ? ` • ${year}` : ''}
                                                        </p>
                                                    </div>
                                                    <span className="text-[10px] font-semibold text-[#FF9F43] flex items-center gap-0.5">
                            <Plus className="w-3 h-3" />{' '}
                                                        {attachTab === 'reels' ? 'Send Reel' : 'Attach'}
                          </span>
                                                </button>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>
                        )}

                        {pendingAttachment && (
                            <div className="px-4 py-2 bg-[#14141A] border-t border-white/10 flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    {pendingAttachment.poster_path && (
                                        <img
                                            src={posterUrl(pendingAttachment.poster_path, 'w185')}
                                            alt={pendingAttachment.title}
                                            className="w-7 h-10 rounded object-cover shrink-0"
                                        />
                                    )}
                                    <div className="min-w-0">
                                        <p className="text-[10px] font-semibold text-[#FF9F43] uppercase">
                                            {pendingAttachment.kind === 'reviews'
                                                ? `Sharing @${pendingAttachment.reviewAuthor}'s Review`
                                                : pendingAttachment.kind === 'reels'
                                                    ? 'Attaching Trailer Reel'
                                                    : 'Attaching Movie / Series'}
                                        </p>
                                        <p className="text-xs font-bold text-white truncate">
                                            {pendingAttachment.title}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setPendingAttachment(null)}
                                    className="p-1 text-zinc-400 hover:text-white cursor-pointer"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        )}

                        {sendError && (
                            <div className="px-4 py-1.5 bg-red-500/15 border-t border-red-500/30 text-[11px] text-red-300">
                                {sendError}
                            </div>
                        )}

                        <form
                            onSubmit={handleSendMessage}
                            className="p-3 border-t border-white/10 bg-[#14141A] flex items-center gap-2 shrink-0"
                        >
                            <button
                                type="button"
                                onClick={() => setAttachOpen((o) => !o)}
                                title="Send a movie, reel, or review"
                                className={`px-2.5 py-2 rounded-xl border text-xs font-semibold flex items-center gap-1 transition cursor-pointer shrink-0 ${
                                    attachOpen || pendingAttachment
                                        ? 'bg-[#FF6B4A]/20 border-[#FF6B4A] text-[#FF6B4A]'
                                        : 'bg-[#22222C] border-white/10 text-zinc-300 hover:text-white'
                                }`}
                            >
                                <Plus className="w-4 h-4" />
                                <span className="hidden md:inline">Share</span>
                            </button>

                            <input
                                type="text"
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                placeholder={
                                    activeForum
                                        ? `Message #${activeForum.slug}...`
                                        : `Message @${selectedFriend!.username}...`
                                }
                                className="flex-1 min-w-0 bg-[#22222C] border border-white/10 focus:border-[#FF6B4A] rounded-xl px-3.5 py-2 text-xs text-white placeholder:text-zinc-500 focus:outline-none transition"
                            />

                            <button
                                type="submit"
                                disabled={sending || (!draft.trim() && !pendingAttachment)}
                                className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#FF6B4A] to-[#FF9F43] text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40 cursor-pointer shrink-0"
                            >
                                <Send className="w-3.5 h-3.5" />
                                <span className="hidden sm:inline">Send</span>
                            </button>
                        </form>
                    </>
                )}
            </section>

            <TrailerPreviewModal
                media={previewMedia}
                onClose={() => setPreviewMedia(null)}
                onOpenLogModal={(media) => {
                    setPreviewMedia(null)
                    onOpenMedia?.(media)
                }}
            />
        </div>
    )
}