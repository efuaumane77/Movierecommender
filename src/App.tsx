import { useEffect, useState, useCallback, useRef } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { AuthPage } from './pages/AuthPage'
import { FeedPage } from './pages/FeedPage'
import { TrailersPage } from './pages/TrailersPage'
import { MessagesPage } from './pages/MessagesPage'
import { ReviewsPage } from './pages/ReviewsPage'
import { LibraryPage } from './pages/LibraryPage'
import { SearchPage } from './pages/SearchPage'
import { NotificationsPage, type IncomingRequest } from './pages/NotificationsPage'
import { SettingsPage } from './pages/SettingsPage'
import { AppShell } from './components/layout/AppShell'
import { MediaModal, type SelectedMedia } from './components/media/MediaModal'
import { supabase } from './lib/supabase'
import { readJoinedForumSlugs, writeJoinedForumSlugs } from './lib/forums'
import type { AcceptedFollowNotification, MediaLog, Profile } from './types/database'

function CinerateWorkspace() {
    const { user, loading } = useAuth()
    const navigate = useNavigate()
    const prevUserIdRef = useRef<string | null>(null)

    const [feedLogs, setFeedLogs] = useState<MediaLog[]>([])
    const [myLogs, setMyLogs] = useState<MediaLog[]>([])
    const [friends, setFriends] = useState<Profile[]>([])
    const [suggestedUsers, setSuggestedUsers] = useState<Profile[]>([])
    const [outgoingRequestIds, setOutgoingRequestIds] = useState<Set<string>>(new Set())
    const [incomingRequests, setIncomingRequests] = useState<IncomingRequest[]>([])
    const [acceptedNotifications, setAcceptedNotifications] = useState<AcceptedFollowNotification[]>([])
    const [selectedMedia, setSelectedMedia] = useState<SelectedMedia | null>(null)
    const [joinedForumSlugs, setJoinedForumSlugs] = useState<string[]>(() =>
        readJoinedForumSlugs()
    )
    const [activeForumSlug, setActiveForumSlug] = useState<string | null>(null)

    // Always land on Home ('/') whenever a user signs in, signs up, or signs out
    useEffect(() => {
        const currentId = user?.id ?? null
        if (prevUserIdRef.current !== currentId) {
            prevUserIdRef.current = currentId
            navigate('/', { replace: true })
        }
    }, [user, navigate])

    const refreshData = useCallback(async () => {
        if (!user) return

        const [
            { data: allLogs },
            { data: ownLogs },
            { data: allFriendships },
            { data: allProfiles },
        ] = await Promise.all([
            supabase
                .from('media_logs')
                .select(
                    '*, profiles(id, username, display_name, pronouns, bio, interests, watched_visibility, top_favorites, avatar_url, created_at)'
                )
                .order('updated_at', { ascending: false })
                .limit(100),
            supabase.from('media_logs').select('*').eq('user_id', user.id),
            supabase
                .from('friendships')
                .select(
                    'id, status, requester_id, addressee_id, requester:profiles!friendships_requester_id_fkey(*), addressee:profiles!friendships_addressee_id_fkey(*)'
                )
                .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`),
            supabase.from('profiles').select('*').neq('id', user.id).limit(12),
        ])

        if (allLogs) setFeedLogs(allLogs as MediaLog[])
        if (ownLogs) setMyLogs(ownLogs as MediaLog[])

        const acceptedFriends: Profile[] = []
        const acceptedList: AcceptedFollowNotification[] = []
        const outgoing = new Set<string>()
        const incoming: IncomingRequest[] = []
        const connectedIds = new Set<string>()

        if (allFriendships) {
            for (const row of allFriendships as Record<string, unknown>[]) {
                const isRequester = row.requester_id === user.id
                const otherId = isRequester
                    ? (row.addressee_id as string)
                    : (row.requester_id as string)
                const otherProfile = isRequester
                    ? (row.addressee as Profile)
                    : (row.requester as Profile)
                connectedIds.add(otherId)

                if (row.status === 'accepted') {
                    acceptedFriends.push(otherProfile)
                    acceptedList.push({
                        id: row.id as string,
                        otherUser: otherProfile,
                        direction: isRequester ? 'they_accepted_you' : 'you_accepted_them',
                    })
                } else if (row.status === 'pending') {
                    if (isRequester) {
                        outgoing.add(otherId)
                    } else {
                        incoming.push({
                            id: row.id as string,
                            requester: row.requester as Profile,
                        })
                    }
                }
            }
        }

        setFriends(acceptedFriends)
        setAcceptedNotifications(acceptedList)
        setOutgoingRequestIds(outgoing)
        setIncomingRequests(incoming)

        if (allProfiles) {
            setSuggestedUsers(
                (allProfiles as Profile[]).filter((p) => !connectedIds.has(p.id)).slice(0, 6)
            )
        }
    }, [user])

    useEffect(() => {
        if (!user) return
        let active = true

        Promise.resolve().then(() => {
            if (active) {
                void refreshData()
            }
        })

        const channel = supabase
            .channel(`cinerate-realtime-${user.id}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'friendships' },
                () => {
                    if (active) void refreshData()
                }
            )
            .subscribe()

        return () => {
            active = false
            void supabase.removeChannel(channel)
        }
    }, [user, refreshData])

    function handleJoinOrOpenForum(slug: string) {
        setJoinedForumSlugs((prev) => {
            if (prev.includes(slug)) return prev
            const next = [...prev, slug]
            writeJoinedForumSlugs(next)
            return next
        })
        setActiveForumSlug(slug)
    }

    function handleLeaveForum(slug: string) {
        setJoinedForumSlugs((prev) => {
            const next = prev.filter((s) => s !== slug)
            writeJoinedForumSlugs(next)
            return next
        })
        setActiveForumSlug((curr) => (curr === slug ? null : curr))
    }

    async function handleFollowUser(targetUserId: string) {
        if (!user || targetUserId === user.id) return
        setOutgoingRequestIds((prev) => new Set(prev).add(targetUserId))
        await supabase.from('friendships').insert({
            requester_id: user.id,
            addressee_id: targetUserId,
            status: 'pending',
        })
        void refreshData()
    }

    async function handleAcceptRequest(friendshipId: string) {
        await supabase.from('friendships').update({ status: 'accepted' }).eq('id', friendshipId)
        void refreshData()
    }

    async function handleIncrementEpisode(log: MediaLog) {
        await supabase
            .from('media_logs')
            .update({ episode: log.episode + 1, updated_at: new Date().toISOString() })
            .eq('id', log.id)
        void refreshData()
    }

    if (loading) {
        return (
            <div className="min-h-dvh bg-[#0E0E12] flex items-center justify-center text-zinc-400 text-sm">
                Loading Cinerate...
            </div>
        )
    }

    if (!user) return <AuthPage />

    const watching = myLogs.filter((l) => l.status === 'watching')
    const friendIds = new Set(friends.map((f) => f.id))
    const friendLogs = feedLogs.filter((l) => friendIds.has(l.user_id))
    const existingLog = selectedMedia
        ? myLogs.find(
            (l) => l.tmdb_id === selectedMedia.tmdb_id && l.media_type === selectedMedia.media_type
        )
        : undefined

    return (
        <>
            <Routes>
                <Route
                    element={
                        <AppShell
                            watching={watching}
                            suggestedUsers={suggestedUsers}
                            outgoingRequestIds={outgoingRequestIds}
                            friendIds={friendIds}
                            notificationCount={incomingRequests.length}
                            joinedForumSlugs={joinedForumSlugs}
                            activeForumSlug={activeForumSlug}
                            onFollowUser={handleFollowUser}
                            onJoinOrOpenForum={handleJoinOrOpenForum}
                            onLeaveForum={handleLeaveForum}
                            onIncrementEpisode={handleIncrementEpisode}
                            onOpenMedia={setSelectedMedia}
                            onProfileUpdated={() => void refreshData()}
                        />
                    }
                >
                    <Route
                        path="/"
                        element={
                            <FeedPage
                                feedLogs={feedLogs}
                                myLogs={myLogs}
                                friends={friends}
                                joinedForumSlugs={joinedForumSlugs}
                                onOpenMedia={setSelectedMedia}
                                onJoinOrOpenForum={handleJoinOrOpenForum}
                                onLogsUpdated={() => void refreshData()}
                            />
                        }
                    />
                    <Route
                        path="/trailers"
                        element={
                            <TrailersPage
                                feedLogs={feedLogs}
                                myLogs={myLogs}
                                friends={friends}
                                friendIds={friendIds}
                                outgoingRequestIds={outgoingRequestIds}
                                onFollowUser={handleFollowUser}
                                onOpenMedia={setSelectedMedia}
                                onLogsUpdated={() => void refreshData()}
                            />
                        }
                    />
                    <Route
                        path="/messages"
                        element={
                            <MessagesPage
                                friends={friends}
                                joinedForumSlugs={joinedForumSlugs}
                                activeForumSlug={activeForumSlug}
                                onSelectForum={setActiveForumSlug}
                                onJoinOrOpenForum={handleJoinOrOpenForum}
                                onOpenMedia={setSelectedMedia}
                            />
                        }
                    />
                    <Route
                        path="/reviews"
                        element={
                            <ReviewsPage
                                feedLogs={feedLogs}
                                myLogs={myLogs}
                                friends={friends}
                                joinedForumSlugs={joinedForumSlugs}
                                onOpenMedia={setSelectedMedia}
                                onLogsUpdated={() => void refreshData()}
                            />
                        }
                    />
                    <Route
                        path="/search"
                        element={
                            <SearchPage
                                friendIds={friendIds}
                                outgoingRequestIds={outgoingRequestIds}
                                onFollowUser={handleFollowUser}
                                onOpenMedia={setSelectedMedia}
                            />
                        }
                    />
                    <Route
                        path="/notifications"
                        element={
                            <NotificationsPage
                                incomingRequests={incomingRequests}
                                acceptedNotifications={acceptedNotifications}
                                friendLogs={friendLogs}
                                friendIds={friendIds}
                                outgoingRequestIds={outgoingRequestIds}
                                onFollowUser={handleFollowUser}
                                onAcceptRequest={handleAcceptRequest}
                            />
                        }
                    />
                    <Route
                        path="/library"
                        element={
                            <LibraryPage
                                feedLogs={feedLogs}
                                myLogs={myLogs}
                                friends={friends}
                                friendIds={friendIds}
                                outgoingRequestIds={outgoingRequestIds}
                                onFollowUser={handleFollowUser}
                                onOpenMedia={setSelectedMedia}
                                onLogsUpdated={() => void refreshData()}
                                onFriendsUpdated={() => void refreshData()}
                            />
                        }
                    />
                    <Route
                        path="/profile/:userId"
                        element={
                            <LibraryPage
                                feedLogs={feedLogs}
                                myLogs={myLogs}
                                friends={friends}
                                friendIds={friendIds}
                                outgoingRequestIds={outgoingRequestIds}
                                onFollowUser={handleFollowUser}
                                onOpenMedia={setSelectedMedia}
                                onLogsUpdated={() => void refreshData()}
                                onFriendsUpdated={() => void refreshData()}
                            />
                        }
                    />
                    <Route
                        path="/settings"
                        element={
                            <SettingsPage
                                myLogs={myLogs}
                                onProfileUpdated={() => void refreshData()}
                            />
                        }
                    />
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
            </Routes>

            <MediaModal
                media={selectedMedia}
                existingLog={existingLog}
                onClose={() => setSelectedMedia(null)}
                onSaved={() => void refreshData()}
            />
        </>
    )
}

export default function App() {
    return (
        <ThemeProvider>
            <AuthProvider>
                <BrowserRouter>
                    <CinerateWorkspace />
                </BrowserRouter>
            </AuthProvider>
        </ThemeProvider>
    )
}