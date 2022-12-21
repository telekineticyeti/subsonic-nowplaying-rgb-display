declare namespace LastFm {
  interface NowPlaying {
    recenttracks: {
      track: Track[];
    };
    '@attr': {
      user: string;
      totalPages: string;
      page: string;
      perPage: string;
      total: string;
    };
    error?: number;
    message?: string;
  }

  interface Track {
    artist: {
      mbid: string;
      '#text': string;
    };
    streamable: string;
    image: {
      size: ImageSize;
      '#text': string;
    }[];
    mbid: string;
    album: {
      mbid: string;
      '#text': string;
    };
    name: string;
    '@attr'?: {
      nowplaying: string;
    };
    url: string;
  }

  type ImageSize = 'small' | 'medium' | 'large' | 'extralarge';
}
