/** @file ID3v1 genre list and look-up utilities. Provides the standard 192-genre table and helper functions. */

/** The canonical list of 192 ID3v1 genre names, indexed by genre number. */
const genres: readonly string[] = [
  "Blues",
  "Classic Rock",
  "Country",
  "Dance",
  "Disco",
  "Funk",
  "Grunge",
  "Hip-Hop",
  "Jazz",
  "Metal",
  "New Age",
  "Oldies",
  "Other",
  "Pop",
  "R&B",
  "Rap",
  "Reggae",
  "Rock",
  "Techno",
  "Industrial",
  "Alternative",
  "Ska",
  "Death Metal",
  "Pranks",
  "Soundtrack",
  "Euro-Techno",
  "Ambient",
  "Trip-Hop",
  "Vocal",
  "Jazz-Funk",
  "Fusion",
  "Trance",
  "Classical",
  "Instrumental",
  "Acid",
  "House",
  "Game",
  "Sound Clip",
  "Gospel",
  "Noise",
  "Alternative Rock",
  "Bass",
  "Soul",
  "Punk",
  "Space",
  "Meditative",
  "Instrumental Pop",
  "Instrumental Rock",
  "Ethnic",
  "Gothic",
  "Darkwave",
  "Techno-Industrial",
  "Electronic",
  "Pop-Folk",
  "Eurodance",
  "Dream",
  "Southern Rock",
  "Comedy",
  "Cult",
  "Gangsta",
  "Top 40",
  "Christian Rap",
  "Pop/Funk",
  "Jungle",
  "Native American",
  "Cabaret",
  "New Wave",
  "Psychedelic",
  "Rave",
  "Showtunes",
  "Trailer",
  "Lo-Fi",
  "Tribal",
  "Acid Punk",
  "Acid Jazz",
  "Polka",
  "Retro",
  "Musical",
  "Rock & Roll",
  "Hard Rock",
  "Folk",
  "Folk Rock",
  "National Folk",
  "Swing",
  "Fast Fusion",
  "Bebop",
  "Latin",
  "Revival",
  "Celtic",
  "Bluegrass",
  "Avant-garde",
  "Gothic Rock",
  "Progressive Rock",
  "Psychedelic Rock",
  "Symphonic Rock",
  "Slow Rock",
  "Big Band",
  "Chorus",
  "Easy Listening",
  "Acoustic",
  "Humour",
  "Speech",
  "Chanson",
  "Opera",
  "Chamber Music",
  "Sonata",
  "Symphony",
  "Booty Bass",
  "Primus",
  "Porn Groove",
  "Satire",
  "Slow Jam",
  "Club",
  "Tango",
  "Samba",
  "Folklore",
  "Ballad",
  "Power Ballad",
  "Rhythmic Soul",
  "Freestyle",
  "Duet",
  "Punk Rock",
  "Drum Solo",
  "A Cappella",
  "Euro-House",
  "Dancehall",
  "Goa",
  "Drum & Bass",
  "Club-House",
  "Hardcore Techno",
  "Terror",
  "Indie",
  "Britpop",
  "Worldbeat",
  "Polsk Punk",
  "Beat",
  "Christian Gangsta Rap",
  "Heavy Metal",
  "Black Metal",
  "Crossover",
  "Contemporary Christian",
  "Christian Rock",
  "Merengue",
  "Salsa",
  "Thrash Metal",
  "Anime",
  "Jpop",
  "Synthpop",
  "Abstract",
  "Art Rock",
  "Baroque",
  "Bhangra",
  "Big Beat",
  "Breakbeat",
  "Chillout",
  "Downtempo",
  "Dub",
  "EBM",
  "Eclectic",
  "Electro",
  "Electroclash",
  "Emo",
  "Experimental",
  "Garage",
  "Global",
  "IDM",
  "Illbient",
  "Industro-Goth",
  "Jam Band",
  "Krautrock",
  "Leftfield",
  "Lounge",
  "Math Rock",
  "New Romantic",
  "Nu-Breakz",
  "Post-Punk",
  "Post-Rock",
  "Psytrance",
  "Shoegaze",
  "Space Rock",
  "Trop Rock",
  "World Music",
  "Neoclassical",
  "Audiobook",
  "Audio Theatre",
  "Neue Deutsche Welle",
  "Podcast",
  "Indie Rock",
  "G-Funk",
  "Dubstep",
  "Garage Rock",
  "Psybient",
];

/** Alternative (deprecated) genre name spellings mapped to their canonical genre index. */
// Alternate names that have been changed over time, mapped to the current index.
const fixUpGenres: ReadonlyMap<string, number> = new Map([
  ["Jazz+Funk", 29],
  ["Folk/Rock", 81],
  ["Bebob", 85],
  ["Avantgarde", 90],
  ["Dance Hall", 125],
  ["Hardcore", 129],
  ["BritPop", 132],
  ["Negerpunk", 133],
]);

/**
 * Returns the genre name for the given index, or an empty string if the
 * index is out of range.
 */
export function genre(index: number): string {
  if (index >= 0 && index < genres.length) {
    return genres[index];
  }
  return "";
}

/**
 * Returns the genre index for the given name, or 255 if not found.
 * Also recognises legacy alternate names.
 */
export function genreIndex(name: string): number {
  for (let i = 0; i < genres.length; i++) {
    if (name === genres[i]) {
      return i;
    }
  }

  const fixUp = fixUpGenres.get(name);
  if (fixUp !== undefined) {
    return fixUp;
  }

  return 255;
}

/** Returns a copy of the complete genre list. */
export function genreList(): string[] {
  return [...genres];
}

/** Returns a map from genre name to index. */
export function genreMap(): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < genres.length; i++) {
    m.set(genres[i], i);
  }
  return m;
}
