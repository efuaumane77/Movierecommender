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