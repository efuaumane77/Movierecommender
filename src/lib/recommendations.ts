import { supabase } from './supabase'
import type { MediaLog, Profile } from '../types/database'

const TMDB_BASE = 'https://api.themoviedb.org/3'
const TOKEN = import.meta.env.VITE_TMDB_API_KEY as string

const INTEREST_TO_GENRE_IDS: Record<string, number[]> = {
    Superheroes: [28, 12, 878],
    Horror: [27],
    'Sci-Fi': [878, 10765],
    Thrillers: [53, 80],
    Anime: [16],
    Drama: [18],
    Action: [28, 10759],
    Comedy: [35],
    Mystery: [9648],
    Indie: [18, 10749],
}

export interface RecommendedItem {
    id: number
    media_type: 'movie' | 'tv'
    title: string
    poster_path: string | null
    overview: string
    release_date?: string
    genre_ids: number[]
    popularity: number
    score: number
    reason: string
}

async function tmdbFetchJson<T>(endpoint: string): Promise<T> {
    if (!TOKEN) {
        throw new Error('Missing VITE_TMDB_API_KEY in your .env file')
    }
    const res = await fetch(`${TMDB_BASE}${endpoint}`, {
        headers: {
            Authorization: `Bearer ${TOKEN}`,
            'Content-Type': 'application/json',
        },
    })
    if (!res.ok) {
        throw new Error(`TMDB request failed (${res.status})`)
    }
    return res.json() as Promise<T>
}

interface SeedEntry {
    id: number
    media_type: 'movie' | 'tv'
    weight: number
    title?: string
}

export async function getPersonalizedRecommendations(params: {
    userId: string
    profile: Profile | null
    myLogs: MediaLog[]
    feedLogs: MediaLog[]
    friendIds: Set<string>
}): Promise<RecommendedItem[]> {
    const { userId, profile, myLogs, feedLogs, friendIds } = params

    // 1. Fetch implicit signals from Supabase (liked trailers + trailer reviews)
    const [{ data: likedTrailers }, { data: trailerComments }] = await Promise.all([
        supabase
            .from('trailer_likes')
            .select('tmdb_id, media_type, created_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(25),
        supabase
            .from('trailer_comments')
            .select('tmdb_id, media_type, rating')
            .eq('user_id', userId)
            .limit(25),
    ])

    // 2. Build exclusion set (already watched, watching, or watchlisted) & seed weights
    const seenKeys = new Set<string>(myLogs.map((l) => `${l.media_type}-${l.tmdb_id}`))
    const seedMap = new Map<string, SeedEntry>()
    const genreWeights = new Map<number, number>()

    // Seed genre affinities from explicit profile interest pills
    for (const interest of profile?.interests ?? []) {
        const mappedIds = INTEREST_TO_GENRE_IDS[interest] ?? []
        for (const gid of mappedIds) {
            genreWeights.set(gid, (genreWeights.get(gid) ?? 0) + 1.5)
        }
    }

    // Weight watched logs, ratings, watching status, and watchlist items
    for (const log of myLogs) {
        const key = `${log.media_type}-${log.tmdb_id}`
        let weight = 1
        if (log.rating !== null) {
            if (log.rating >= 4) weight = 5
            else if (log.rating === 3) weight = 2
            else weight = -4
        } else if (log.status === 'watching' || log.status === 'watchlist') {
            weight = 2.5
        }

        seedMap.set(key, {
            id: log.tmdb_id,
            media_type: log.media_type,
            weight,
            title: log.title,
        })
    }

    // Weight liked trailers (+3)
    for (const like of likedTrailers ?? []) {
        const mediaType = like.media_type === 'tv' ? 'tv' : 'movie'
        const key = `${mediaType}-${like.tmdb_id}`
        const existing = seedMap.get(key)
        seedMap.set(key, {
            id: Number(like.tmdb_id),
            media_type: mediaType,
            weight: (existing?.weight ?? 0) + 3,
            title: existing?.title,
        })
    }

    // Weight trailer reviews (+2 positive, -3 negative)
    for (const comment of trailerComments ?? []) {
        const mediaType = comment.media_type === 'tv' ? 'tv' : 'movie'
        const key = `${mediaType}-${comment.tmdb_id}`
        const delta = comment.rating !== null && comment.rating <= 2 ? -3 : 2
        const existing = seedMap.get(key)
        seedMap.set(key, {
            id: Number(comment.tmdb_id),
            media_type: mediaType,
            weight: (existing?.weight ?? 0) + delta,
            title: existing?.title,
        })
    }

    // Pick top 4 positive seeds to pull similar titles from TMDB
    const topPositiveSeeds = Array.from(seedMap.values())
        .filter((s) => s.weight > 0)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 4)

    // 3. Candidate Generation: TMDB recommendations + genre discovery + trending exploration
    const candidateMap = new Map<string, RecommendedItem>()

    const tasks: Promise<void>[] = topPositiveSeeds.map(async (seed) => {
        try {
            const data = await tmdbFetchJson<{ results?: Array<Record<string, unknown>> }>(
                `/${seed.media_type}/${seed.id}/recommendations?page=1`
            )
            for (const raw of (data.results ?? []).slice(0, 12)) {
                const id = Number(raw.id)
                if (!id) continue
                const key = `${seed.media_type}-${id}`
                if (seenKeys.has(key)) continue

                const gids = Array.isArray(raw.genre_ids) ? (raw.genre_ids as number[]) : []
                for (const gid of gids) {
                    genreWeights.set(gid, (genreWeights.get(gid) ?? 0) + seed.weight * 0.25)
                }

                const existing = candidateMap.get(key)
                const scoreBoost = seed.weight * 2.2
                const reasonLabel = seed.title
                    ? `Because you liked ${seed.title}`
                    : 'Based on your trailer likes'

                candidateMap.set(key, {
                    id,
                    media_type: seed.media_type,
                    title: String(raw.title || raw.name || 'Untitled'),
                    poster_path: (raw.poster_path as string) ?? null,
                    overview: String(raw.overview || ''),
                    release_date: String(raw.release_date || raw.first_air_date || ''),
                    genre_ids: gids,
                    popularity: Number(raw.popularity || 0),
                    score: (existing?.score ?? 0) + scoreBoost,
                    reason: existing ? existing.reason : reasonLabel,
                })
            }
        } catch {
            // Skip individual seed failure if TMDB has no recommendations for that ID
        }
    })

    // Cold-start / genre-affinity discovery if user has profile interests
    const topGenreIds = Array.from(genreWeights.entries())
        .filter(([, w]) => w > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([gid]) => gid)

    if (topGenreIds.length > 0) {
        const genreQuery = topGenreIds.join('|')
        tasks.push(
            tmdbFetchJson<{ results?: Array<Record<string, unknown>> }>(
                `/discover/movie?with_genres=${encodeURIComponent(genreQuery)}&sort_by=popularity.desc&vote_count.gte=150&page=1`
            )
                .then((data) => {
                    for (const raw of (data.results ?? []).slice(0, 10)) {
                        const id = Number(raw.id)
                        const key = `movie-${id}`
                        if (!id || seenKeys.has(key) || candidateMap.has(key)) continue
                        candidateMap.set(key, {
                            id,
                            media_type: 'movie',
                            title: String(raw.title || 'Untitled'),
                            poster_path: (raw.poster_path as string) ?? null,
                            overview: String(raw.overview || ''),
                            release_date: String(raw.release_date || ''),
                            genre_ids: Array.isArray(raw.genre_ids) ? (raw.genre_ids as number[]) : [],
                            popularity: Number(raw.popularity || 0),
                            score: 3.5,
                            reason: 'Matches your interests',
                        })
                    }
                })
                .catch(() => {})
        )
    }

    // Exploration bucket from weekly trending
    tasks.push(
        tmdbFetchJson<{ results?: Array<Record<string, unknown>> }>('/trending/all/week?page=1')
            .then((data) => {
                for (const raw of (data.results ?? []).slice(0, 14)) {
                    const mediaType =
                        raw.media_type === 'tv' ? 'tv' : raw.media_type === 'movie' ? 'movie' : null
                    if (!mediaType) continue
                    const id = Number(raw.id)
                    const key = `${mediaType}-${id}`
                    if (!id || seenKeys.has(key) || candidateMap.has(key)) continue

                    candidateMap.set(key, {
                        id,
                        media_type: mediaType,
                        title: String(raw.title || raw.name || 'Untitled'),
                        poster_path: (raw.poster_path as string) ?? null,
                        overview: String(raw.overview || ''),
                        release_date: String(raw.release_date || raw.first_air_date || ''),
                        genre_ids: Array.isArray(raw.genre_ids) ? (raw.genre_ids as number[]) : [],
                        popularity: Number(raw.popularity || 0),
                        score: 1.5,
                        reason: 'Popular on Cinerate',
                    })
                }
            })
            .catch(() => {})
    )

    await Promise.all(tasks)

    // 4. Heavy Ranking: apply genre affinity + social proof from friends' high ratings
    const friendPicks = new Map<string, string>()
    for (const log of feedLogs) {
        if (friendIds.has(log.user_id) && (log.rating ?? 0) >= 4 && log.profiles?.username) {
            friendPicks.set(`${log.media_type}-${log.tmdb_id}`, log.profiles.username)
        }
    }

    for (const [key, item] of candidateMap.entries()) {
        let genreBonus = 0
        for (const gid of item.genre_ids) {
            genreBonus += (genreWeights.get(gid) ?? 0) * 0.6
        }
        item.score += genreBonus

        const friendUsername = friendPicks.get(key)
        if (friendUsername) {
            item.score += 4.5
            item.reason = `Rated ★4+ by @${friendUsername}`
        }
    }

    // 5. Re-ranking & Diversity: sort by score and avoid showing >3 items from the exact same reason in a row
    const sorted = Array.from(candidateMap.values()).sort((a, b) => b.score - a.score)
    const diversified: RecommendedItem[] = []
    const reasonCounts = new Map<string, number>()

    for (const item of sorted) {
        const count = reasonCounts.get(item.reason) ?? 0
        if (count >= 4) continue
        reasonCounts.set(item.reason, count + 1)
        diversified.push(item)
        if (diversified.length >= 16) break
    }

    return diversified
}