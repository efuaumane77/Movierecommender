const TMDB_BASE = 'https://api.themoviedb.org/3'
const TOKEN = import.meta.env.VITE_TMDB_API_KEY as string

export const posterUrl = (path: string | null, size: 'w185' | 'w342' | 'w500' = 'w342') =>
    path ? `https://image.tmdb.org/t/p/${size}${path}` : ''

async function tmdbFetch<T>(endpoint: string): Promise<T> {
    if (!TOKEN) {
        throw new Error('Missing VITE_TMDB_API_KEY in your .env file')
    }
    const res = await fetch(`${TMDB_BASE}${endpoint}`, {
        headers: {
            Authorization: `Bearer ${TOKEN}`,
            accept: 'application/json',
        },
    })
    if (!res.ok) throw new Error(`TMDB error: ${res.status}`)
    return res.json()
}

export interface TMDBSearchResult {
    id: number
    media_type: 'movie' | 'tv'
    title?: string
    name?: string
    poster_path: string | null
    backdrop_path: string | null
    overview: string
    release_date?: string
    first_air_date?: string
    vote_average: number
}

export interface TMDBPersonSearchResult {
    id: number
    name: string
    role: 'Director' | 'Actor'
    profile_path: string | null
    known_for_titles: string[]
}

export interface WatchProviderItem {
    provider_id: number
    provider_name: string
    logo_path: string
}

export interface WatchProvidersSummary {
    flatrate: WatchProviderItem[]
    rent: WatchProviderItem[]
    buy: WatchProviderItem[]
    link?: string
}

export async function searchMulti(query: string): Promise<TMDBSearchResult[]> {
    if (!query.trim()) return []
    const data = await tmdbFetch<{ results: TMDBSearchResult[] }>(
        `/search/multi?query=${encodeURIComponent(query)}&include_adult=false`
    )
    return data.results.filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
}

export async function searchPeople(query: string): Promise<TMDBPersonSearchResult[]> {
    if (!query.trim()) return []
    const data = await tmdbFetch<{
        results?: Array<{
            id: number
            name: string
            known_for_department?: string
            profile_path: string | null
            known_for?: Array<{ title?: string; name?: string }>
        }>
    }>(`/search/person?query=${encodeURIComponent(query)}&include_adult=false`)

    return (data.results ?? [])
        .filter((p) => p.known_for_department === 'Acting' || p.known_for_department === 'Directing')
        .slice(0, 8)
        .map((p) => ({
            id: p.id,
            name: p.name,
            role: p.known_for_department === 'Directing' ? 'Director' : 'Actor',
            profile_path: p.profile_path,
            known_for_titles: (p.known_for ?? [])
                .map((k) => k.title || k.name || '')
                .filter(Boolean)
                .slice(0, 3),
        }))
}

export async function getTrending(page = 1): Promise<TMDBSearchResult[]> {
    const data = await tmdbFetch<{ results: TMDBSearchResult[] }>(
        `/trending/all/week?page=${page}`
    )
    return (data.results ?? []).filter(
        (item) => item.media_type === 'movie' || item.media_type === 'tv'
    )
}

export async function getTrailerKey(mediaType: 'movie' | 'tv', id: number): Promise<string | null> {
    const data = await tmdbFetch<{ results: { key: string; site: string; type: string }[] }>(
        `/${mediaType}/${id}/videos`
    )
    const trailer =
        data.results.find((v) => v.site === 'YouTube' && v.type === 'Trailer') ||
        data.results.find((v) => v.site === 'YouTube')
    return trailer ? trailer.key : null
}

export async function getWatchProviders(
    mediaType: 'movie' | 'tv',
    id: number,
    region = 'CA'
): Promise<WatchProvidersSummary> {
    const data = await tmdbFetch<{
        results?: Record<
            string,
            {
                link?: string
                flatrate?: WatchProviderItem[]
                rent?: WatchProviderItem[]
                buy?: WatchProviderItem[]
            }
        >
    }>(`/${mediaType}/${id}/watch/providers`)

    const regionBlock = data.results?.[region] ?? data.results?.US
    return {
        flatrate: (regionBlock?.flatrate ?? []).slice(0, 6),
        rent: (regionBlock?.rent ?? []).slice(0, 4),
        buy: (regionBlock?.buy ?? []).slice(0, 4),
        link: regionBlock?.link,
    }
}

export interface TMDBPersonCredit {
    id: number
    name: string
    role: 'Director' | 'Actor'
    character?: string
    profile_path: string | null
}

export async function getMediaCredits(
    mediaType: 'movie' | 'tv',
    id: number
): Promise<TMDBPersonCredit[]> {
    const data = await tmdbFetch<{
        cast?: { id: number; name: string; character?: string; profile_path: string | null }[]
        crew?: { id: number; name: string; job?: string; profile_path: string | null }[]
    }>(`/${mediaType}/${id}/credits`)

    const directors: TMDBPersonCredit[] = (data.crew ?? [])
        .filter((c) => c.job === 'Director')
        .slice(0, 4)
        .map((d) => ({
            id: d.id,
            name: d.name,
            role: 'Director',
            profile_path: d.profile_path,
        }))

    const fullCast: TMDBPersonCredit[] = (data.cast ?? [])
        .slice(0, 40)
        .map((a) => ({
            id: a.id,
            name: a.name,
            role: 'Actor',
            character: a.character,
            profile_path: a.profile_path,
        }))

    const seen = new Set<number>()
    return [...directors, ...fullCast].filter((p) => {
        if (seen.has(p.id)) return false
        seen.add(p.id)
        return true
    })
}

export async function getPersonFilmography(personId: number): Promise<TMDBSearchResult[]> {
    const data = await tmdbFetch<{
        cast?: (TMDBSearchResult & { vote_count?: number })[]
        crew?: (TMDBSearchResult & { job?: string; vote_count?: number })[]
    }>(`/person/${personId}/combined_credits`)

    const directed = (data.crew ?? []).filter((c) => c.job === 'Director')
    const acted = data.cast ?? []
    const combined = [...directed, ...acted].filter(
        (item) => (item.media_type === 'movie' || item.media_type === 'tv') && item.poster_path
    )

    const deduped = new Map<string, TMDBSearchResult & { vote_count?: number }>()
    for (const item of combined) {
        const key = `${item.media_type}-${item.id}`
        if (!deduped.has(key)) deduped.set(key, item)
    }

    return Array.from(deduped.values())
        .sort((a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0))
        .slice(0, 12)
}

export async function getSimilarRecommendations(
    mediaType: 'movie' | 'tv',
    id: number
): Promise<TMDBSearchResult[]> {
    const data = await tmdbFetch<{ results?: TMDBSearchResult[] }>(
        `/${mediaType}/${id}/recommendations`
    )
    return (data.results ?? [])
        .filter((r) => (r.media_type === 'movie' || r.media_type === 'tv') && r.poster_path)
        .slice(0, 8)
}

export async function getTrendingPeople(page = 1): Promise<TMDBPersonSearchResult[]> {
    const data = await tmdbFetch<{
        results?: Array<{
            id: number
            name: string
            known_for_department?: string
            profile_path: string | null
            known_for?: Array<{ title?: string; name?: string }>
        }>
    }>(`/trending/person/week?page=${page}`)

    return (data.results ?? [])
        .filter((p) => p.known_for_department === 'Acting' || p.known_for_department === 'Directing')
        .slice(0, 8)
        .map((p) => ({
            id: p.id,
            name: p.name,
            role: p.known_for_department === 'Directing' ? 'Director' : 'Actor',
            profile_path: p.profile_path,
            known_for_titles: (p.known_for ?? [])
                .map((k) => k.title || k.name || '')
                .filter(Boolean)
                .slice(0, 3),
        }))
}

export interface GenrePreset {
    slug: string
    label: string
    movieGenreIds: number[]
    tvGenreIds: number[]
    keywords?: string[]
}

export const GENRE_PRESETS: GenrePreset[] = [
    { slug: 'action', label: 'Action', movieGenreIds: [28], tvGenreIds: [10759], keywords: ['action'] },
    { slug: 'horror', label: 'Horror', movieGenreIds: [27], tvGenreIds: [9648, 10765], keywords: ['horror', 'scary'] },
    { slug: 'sci-fi', label: 'Sci-Fi', movieGenreIds: [878], tvGenreIds: [10765], keywords: ['sci-fi', 'scifi', 'science fiction'] },
    { slug: 'thrillers', label: 'Thrillers', movieGenreIds: [53], tvGenreIds: [80, 9648], keywords: ['thriller', 'thrillers'] },
    { slug: 'superheroes', label: 'Superheroes', movieGenreIds: [28, 12, 878], tvGenreIds: [10759, 10765], keywords: ['superhero', 'superheroes', 'marvel', 'dc'] },
    { slug: 'comedy', label: 'Comedy', movieGenreIds: [35], tvGenreIds: [35], keywords: ['comedy', 'comedies', 'funny'] },
    { slug: 'drama', label: 'Drama', movieGenreIds: [18], tvGenreIds: [18], keywords: ['drama', 'dramas'] },
    { slug: 'animation', label: 'Animation', movieGenreIds: [16], tvGenreIds: [16], keywords: ['animation', 'animated', 'anime'] },
    { slug: 'mystery', label: 'Mystery', movieGenreIds: [9648], tvGenreIds: [9648], keywords: ['mystery', 'mysteries'] },
    { slug: 'crime', label: 'Crime', movieGenreIds: [80], tvGenreIds: [80], keywords: ['crime', 'gangster'] },
    { slug: 'romance', label: 'Romance', movieGenreIds: [10749], tvGenreIds: [10749], keywords: ['romance', 'romantic', 'romcom'] },
    { slug: 'fantasy', label: 'Fantasy', movieGenreIds: [14], tvGenreIds: [10765], keywords: ['fantasy'] },
]

export function matchGenreFromQuery(rawQuery: string): GenrePreset | null {
    const normalized = rawQuery.trim().toLowerCase()
    if (!normalized) return null
    return (
        GENRE_PRESETS.find(
            (g) =>
                g.slug === normalized ||
                g.label.toLowerCase() === normalized ||
                (g.keywords ?? []).includes(normalized)
        ) ?? null
    )
}

export async function discoverByGenre(genre: GenrePreset): Promise<TMDBSearchResult[]> {
    const movieGenresParam = encodeURIComponent(genre.movieGenreIds.join(','))
    const tvGenresParam = encodeURIComponent(genre.tvGenreIds.join(','))

    const [moviesData, tvData] = await Promise.all([
        tmdbFetch<{ results?: Array<Omit<TMDBSearchResult, 'media_type'>> }>(
            `/discover/movie?with_genres=${movieGenresParam}&sort_by=popularity.desc&vote_count.gte=250&page=1`
        ),
        tmdbFetch<{ results?: Array<Omit<TMDBSearchResult, 'media_type'>> }>(
            `/discover/tv?with_genres=${tvGenresParam}&sort_by=popularity.desc&vote_count.gte=150&page=1`
        ),
    ])

    const movies: TMDBSearchResult[] = (moviesData.results ?? [])
        .filter((m) => Boolean(m.poster_path))
        .slice(0, 12)
        .map((m) => ({ ...m, media_type: 'movie' }))

    const shows: TMDBSearchResult[] = (tvData.results ?? [])
        .filter((t) => Boolean(t.poster_path))
        .slice(0, 6)
        .map((t) => ({ ...t, media_type: 'tv' }))

    // Interleave movies and top TV shows so movies lead cleanly
    const merged: TMDBSearchResult[] = []
    const maxLen = Math.max(movies.length, shows.length)
    for (let i = 0; i < maxLen; i++) {
        if (movies[i]) merged.push(movies[i])
        if (shows[i]) merged.push(shows[i])
    }
    return merged.slice(0, 16)
}