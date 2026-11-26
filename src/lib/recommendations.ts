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
    reason?: string
}

async function tmdbFetchJson<T>(endpoint: string): Promise<T> {
    if (!TOKEN) throw new Error('Missing VITE_TMDB_API_KEY in your .env file')
    const res = await fetch(`${TMDB_BASE}${endpoint}`, {
        headers: {
            Authorization: `Bearer ${TOKEN}`,
            'Content-Type': 'application/json',
        },
    })
    if (!res.ok) throw new Error(`TMDB request failed (${res.status})`)
    return res.json() as Promise<T>
}

interface SeedEntry {
    id: number
    media_type: 'movie' | 'tv'
    weight: number
    title?: string
}

interface FollowedPersonRow {
    person_id: number
    name: string
    role: 'Actor' | 'Director'
}

export async function getPersonalizedRecommendations(params: {
    userId: string
    profile: Profile | null
    myLogs: MediaLog[]
    feedLogs: MediaLog[]
    friendIds: Set<string>
}): Promise<RecommendedItem[]> {
    const { userId, profile, myLogs, feedLogs, friendIds } = params

    const [
        { data: likedTrailers },
        { data: trailerComments },
        { data: trailerViews },
        { data: followedPeople },
    ] = await Promise.all([
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
        supabase
            .from('trailer_views')
            .select('tmdb_id, media_type, watch_seconds, duration_seconds, completion_rate')
            .eq('user_id', userId)
            .order('updated_at', { ascending: false })
            .limit(40),
        supabase
            .from('followed_people')
            .select('person_id, name, role')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(12),
    ])

    const seenKeys = new Set<string>(myLogs.map((l) => `${l.media_type}-${l.tmdb_id}`))
    const seedMap = new Map<string, SeedEntry>()
    const genreWeights = new Map<number, number>()

    for (const interest of profile?.interests ?? []) {
        const mappedIds = INTEREST_TO_GENRE_IDS[interest] ?? []
        for (const gid of mappedIds) {
            genreWeights.set(gid, (genreWeights.get(gid) ?? 0) + 1.5)
        }
    }

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

    for (const view of trailerViews ?? []) {
        const mediaType = view.media_type === 'tv' ? 'tv' : 'movie'
        const key = `${mediaType}-${view.tmdb_id}`
        const completion = Number(view.completion_rate || 0)
        const watchedSec = Number(view.watch_seconds || 0)
        const durSec = Number(view.duration_seconds || 0)

        let dwellDelta = 0
        if (completion >= 0.6) dwellDelta = 3
        else if (durSec >= 15 && watchedSec > 0 && watchedSec < 3) dwellDelta = -2

        if (dwellDelta !== 0) {
            const existing = seedMap.get(key)
            seedMap.set(key, {
                id: Number(view.tmdb_id),
                media_type: mediaType,
                weight: (existing?.weight ?? 0) + dwellDelta,
                title: existing?.title,
            })
        }
    }

    const topPositiveSeeds = Array.from(seedMap.values())
        .filter((s) => s.weight > 0)
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 4)

    const candidateMap = new Map<string, RecommendedItem>()
    const personPicks = new Map<string, string>()

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
                candidateMap.set(key, {
                    id,
                    media_type: seed.media_type,
                    title: String(raw.title || raw.name || 'Untitled'),
                    poster_path: (raw.poster_path as string) ?? null,
                    overview: String(raw.overview || ''),
                    release_date: String(raw.release_date || raw.first_air_date || ''),
                    genre_ids: gids,
                    popularity: Number(raw.popularity || 0),
                    score: (existing?.score ?? 0) + seed.weight * 2.2,
                })
            }
        } catch {
            // ignore missing recommendations
        }
    })

    const followedList = ((followedPeople ?? []) as FollowedPersonRow[]).slice(0, 4)
    for (const person of followedList) {
        tasks.push(
            tmdbFetchJson<{
                cast?: Array<Record<string, unknown>>
                crew?: Array<Record<string, unknown>>
            }>(`/person/${person.person_id}/combined_credits`)
                .then((credits) => {
                    const directed = (credits.crew ?? []).filter((c) => c.job === 'Director')
                    const acted = credits.cast ?? []
                    const pool = [...directed, ...acted]
                        .filter((item) => {
                            const mType = item.media_type
                            return (mType === 'movie' || mType === 'tv') && Boolean(item.poster_path)
                        })
                        .sort((a, b) => Number(b.vote_count || 0) - Number(a.vote_count || 0))
                        .slice(0, 5)

                    for (const raw of pool) {
                        const mediaType = raw.media_type === 'tv' ? 'tv' : 'movie'
                        const id = Number(raw.id)
                        const key = `${mediaType}-${id}`
                        if (!id || seenKeys.has(key)) continue

                        const gids = Array.isArray(raw.genre_ids) ? (raw.genre_ids as number[]) : []
                        for (const gid of gids) {
                            genreWeights.set(gid, (genreWeights.get(gid) ?? 0) + 1.0)
                        }

                        if (!personPicks.has(key)) {
                            personPicks.set(
                                key,
                                person.role === 'Director'
                                    ? `Directed by ${person.name}`
                                    : `Starring ${person.name}`
                            )
                        }

                        const existing = candidateMap.get(key)
                        candidateMap.set(key, {
                            id,
                            media_type: mediaType,
                            title: String(raw.title || raw.name || 'Untitled'),
                            poster_path: (raw.poster_path as string) ?? null,
                            overview: String(raw.overview || ''),
                            release_date: String(raw.release_date || raw.first_air_date || ''),
                            genre_ids: gids,
                            popularity: Number(raw.popularity || 0),
                            score: (existing?.score ?? 0) + 4.0,
                        })
                    }
                })
                .catch(() => {})
        )
    }

    const topGenreIds = Array.from(genreWeights.entries())
        .filter(([, w]) => w > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([gid]) => gid)

    if (topGenreIds.length > 0) {
        tasks.push(
            tmdbFetchJson<{ results?: Array<Record<string, unknown>> }>(
                `/discover/movie?with_genres=${encodeURIComponent(topGenreIds.join('|'))}&sort_by=popularity.desc&vote_count.gte=150&page=1`
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
                        })
                    }
                })
                .catch(() => {})
        )
    }

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
                    })
                }
            })
            .catch(() => {})
    )

    await Promise.all(tasks)

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
        } else if (personPicks.has(key)) {
            item.reason = personPicks.get(key)
        }
    }

    return Array.from(candidateMap.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, 16)
}

export interface RecommendedPerson {
    id: number
    name: string
    role: 'Director' | 'Actor'
    profile_path: string | null
    known_for_titles: string[]
    reason: string
    score: number
}

export async function getRecommendedPeople(params: {
    userId: string
    profile: Profile | null
    myLogs: MediaLog[]
}): Promise<RecommendedPerson[]> {
    const { userId, profile, myLogs } = params

    const { data: followedRows } = await supabase
        .from('followed_people')
        .select('person_id, name, role')
        .eq('user_id', userId)
        .limit(15)

    const followedList = (followedRows ?? []) as FollowedPersonRow[]
    const followedSet = new Set<number>(followedList.map((f) => Number(f.person_id)))

    const personMap = new Map<number, RecommendedPerson>()

    function upsertCandidate(
        raw: {
            id: number
            name: string
            role: 'Director' | 'Actor'
            profile_path: string | null
            known_for?: string
        },
        points: number,
        reason: string
    ) {
        if (!raw.id || !raw.profile_path) return
        const existing = personMap.get(raw.id)
        if (existing) {
            existing.score += points
            if (
                raw.known_for &&
                !existing.known_for_titles.includes(raw.known_for) &&
                existing.known_for_titles.length < 3
            ) {
                existing.known_for_titles.push(raw.known_for)
            }
        } else {
            personMap.set(raw.id, {
                id: raw.id,
                name: raw.name,
                role: raw.role,
                profile_path: raw.profile_path,
                known_for_titles: raw.known_for ? [raw.known_for] : [],
                reason,
                score: points,
            })
        }
    }

    const tasks: Promise<void>[] = []

    // 1. Collaborators & co-stars from actors/directors you follow
    for (const followed of followedList.slice(0, 3)) {
        tasks.push(
            tmdbFetchJson<{
                cast?: Array<Record<string, unknown>>
                crew?: Array<Record<string, unknown>>
            }>(`/person/${followed.person_id}/combined_credits`)
                .then(async (credits) => {
                    const topWorks = [
                        ...(credits.crew ?? []).filter((c) => c.job === 'Director'),
                        ...(credits.cast ?? []),
                    ]
                        .filter(
                            (w) =>
                                (w.media_type === 'movie' || w.media_type === 'tv') &&
                                Number(w.vote_count || 0) >= 300
                        )
                        .sort((a, b) => Number(b.vote_count || 0) - Number(a.vote_count || 0))
                        .slice(0, 2)

                    for (const work of topWorks) {
                        const mType = work.media_type === 'tv' ? 'tv' : 'movie'
                        const workTitle = String(work.title || work.name || '')
                        const fullCredits = await tmdbFetchJson<{
                            cast?: Array<{ id: number; name: string; profile_path: string | null }>
                            crew?: Array<{
                                id: number
                                name: string
                                job?: string
                                profile_path: string | null
                            }>
                        }>(`/${mType}/${work.id}/credits`)

                        for (const d of (fullCredits.crew ?? [])
                            .filter((c) => c.job === 'Director')
                            .slice(0, 1)) {
                            upsertCandidate(
                                {
                                    id: d.id,
                                    name: d.name,
                                    role: 'Director',
                                    profile_path: d.profile_path,
                                    known_for: workTitle,
                                },
                                4.5,
                                `Worked with ${followed.name}`
                            )
                        }
                        for (const a of (fullCredits.cast ?? []).slice(0, 4)) {
                            upsertCandidate(
                                {
                                    id: a.id,
                                    name: a.name,
                                    role: 'Actor',
                                    profile_path: a.profile_path,
                                    known_for: workTitle,
                                },
                                3.5,
                                `Co-starred with ${followed.name}`
                            )
                        }
                    }
                })
                .catch(() => {})
        )
    }

    // 2. Directors & lead cast from your logged / high-rated movies & shows
    const topLogged = [...myLogs]
        .sort((a, b) => (b.rating ?? 3) - (a.rating ?? 3))
        .slice(0, 3)

    for (const log of topLogged) {
        tasks.push(
            tmdbFetchJson<{
                cast?: Array<{ id: number; name: string; profile_path: string | null }>
                crew?: Array<{
                    id: number
                    name: string
                    job?: string
                    profile_path: string | null
                }>
            }>(`/${log.media_type}/${log.tmdb_id}/credits`)
                .then((data) => {
                    for (const d of (data.crew ?? []).filter((c) => c.job === 'Director').slice(0, 1)) {
                        upsertCandidate(
                            {
                                id: d.id,
                                name: d.name,
                                role: 'Director',
                                profile_path: d.profile_path,
                                known_for: log.title,
                            },
                            4.0,
                            `Directed ${log.title}`
                        )
                    }
                    for (const a of (data.cast ?? []).slice(0, 4)) {
                        upsertCandidate(
                            {
                                id: a.id,
                                name: a.name,
                                role: 'Actor',
                                profile_path: a.profile_path,
                                known_for: log.title,
                            },
                            3.0,
                            `Starred in ${log.title}`
                        )
                    }
                })
                .catch(() => {})
        )
    }

    // 3. Mainstream cast & directors from your favorite genres (e.g., Superheroes, Sci-Fi, Thrillers)
    const genreIds = (profile?.interests ?? [])
        .flatMap((interest) => INTEREST_TO_GENRE_IDS[interest] ?? [])
        .slice(0, 3)

    const discoverEndpoint =
        genreIds.length > 0
            ? `/discover/movie?with_genres=${encodeURIComponent(
                genreIds.join('|')
            )}&sort_by=popularity.desc&vote_count.gte=1500&page=1`
            : `/discover/movie?sort_by=popularity.desc&vote_count.gte=2500&page=1`

    tasks.push(
        tmdbFetchJson<{ results?: Array<{ id: number; title?: string }> }>(discoverEndpoint)
            .then(async (data) => {
                const topMovies = (data.results ?? []).slice(0, 3)
                for (const movie of topMovies) {
                    const mTitle = movie.title || 'Popular Hit'
                    const credits = await tmdbFetchJson<{
                        cast?: Array<{ id: number; name: string; profile_path: string | null }>
                        crew?: Array<{
                            id: number
                            name: string
                            job?: string
                            profile_path: string | null
                        }>
                    }>(`/movie/${movie.id}/credits`)

                    for (const d of (credits.crew ?? []).filter((c) => c.job === 'Director').slice(0, 1)) {
                        upsertCandidate(
                            {
                                id: d.id,
                                name: d.name,
                                role: 'Director',
                                profile_path: d.profile_path,
                                known_for: mTitle,
                            },
                            2.5,
                            `Known for ${mTitle}`
                        )
                    }
                    for (const a of (credits.cast ?? []).slice(0, 3)) {
                        upsertCandidate(
                            {
                                id: a.id,
                                name: a.name,
                                role: 'Actor',
                                profile_path: a.profile_path,
                                known_for: mTitle,
                            },
                            2.0,
                            `Known for ${mTitle}`
                        )
                    }
                }
            })
            .catch(() => {})
    )

    await Promise.all(tasks)

    return Array.from(personMap.values())
        .sort((a, b) => {
            const aFollowed = followedSet.has(a.id) ? 1 : 0
            const bFollowed = followedSet.has(b.id) ? 1 : 0
            if (aFollowed !== bFollowed) return aFollowed - bFollowed
            return b.score - a.score
        })
        .slice(0, 8)
}