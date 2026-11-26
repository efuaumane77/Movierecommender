export type MediaStatus = 'watchlist' | 'watching' | 'watched'

export interface Profile {
    id: string
    username: string
    display_name?: string | null
    pronouns?: string | null
    bio?: string | null
    interests?: string[] | null
    watched_visibility?: 'everyone' | 'followers' | null
    avatar_url: string | null
    created_at: string
}

export interface MediaLog {
    id: string
    user_id: string
    tmdb_id: number
    media_type: 'movie' | 'tv'
    title: string
    poster_path: string | null
    status: MediaStatus
    rating: number | null
    review_text: string | null
    season: number
    episode: number
    updated_at: string
    profiles?: Profile
}

export interface TrailerComment {
    id: string
    user_id: string
    tmdb_id: number
    media_type: 'movie' | 'tv'
    rating: number | null
    comment_text: string
    created_at: string
    profiles?: Profile
}

export interface Friendship {
    id: string
    requester_id: string
    addressee_id: string
    status: 'pending' | 'accepted'
    created_at: string
}

export interface AcceptedFollowNotification {
    id: string
    otherUser: Profile
    direction: 'they_accepted_you' | 'you_accepted_them'
}

export interface Message {
    id: string
    sender_id: string
    receiver_id: string
    content: string
    attached_tmdb_id: number | null
    attached_media_type: 'movie' | 'tv' | null
    attached_title: string | null
    attached_poster: string | null
    created_at: string
}