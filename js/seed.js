/* ============================================================
   Sake Journey — sample content
   A curated Western-cuisine pairing dinner. Sakes are illustrative
   archetypes (evocative names, realistic style specs) so the app
   demos richly; Kana - Sake Journey replaces these with the real roster.
   ============================================================ */

/* Serving-temperature tiers (named, with a bulb colour cue) */
export const TEMPS = {
  yukibie:   { label: 'Yuki-bie · 5°C',      hint: 'snow-chilled',  color: '#7fb0d8' },
  hanabie:   { label: 'Hana-bie · 10°C',     hint: 'well chilled',  color: '#93c0d8' },
  suzubie:   { label: 'Suzu-bie · 15°C',     hint: 'lightly cool',  color: '#a9c9c0' },
  joon:      { label: 'Jō-on · 20°C',        hint: 'room temp',     color: '#c9bfa6' },
  hitohada:  { label: 'Hitohada-kan · 35°C', hint: 'skin-warm',     color: '#e0b184' },
  nurukan:   { label: 'Nuru-kan · 40°C',     hint: 'gently warm',   color: '#e0a06a' },
  jokan:     { label: 'Jō-kan · 45°C',       hint: 'warm',          color: '#dd9058' },
};

/* Four-type quadrant → dot position (x: light→rich, y: aroma high→low) */
export const TYPE4 = {
  kunshu:  { name: 'Kunshu',  tag: 'Aromatic & light',  x: 30, y: 26, blurb: 'Fragrant, delicate — floral and fruity' },
  soshu:   { name: 'Sōshu',   tag: 'Quiet & light',     x: 28, y: 72, blurb: 'Crisp, clean, easy-drinking' },
  junshu:  { name: 'Junshu',  tag: 'Quiet & rich',      x: 72, y: 70, blurb: 'Rice umami, savoury, food-loving' },
  jukushu: { name: 'Jukushu', tag: 'Aromatic & rich',   x: 74, y: 28, blurb: 'Aged — caramel, nut, dried fruit' },
};

export const SEED_SAKES = [
  {
    id: 's1', name: 'Shirayuki Sparkling', romaji: '白雪 スパークリング',
    brewery: 'Shirayuki Brewery', region: 'Hyōgo',
    grade: 'sparkling', type4: 'soshu', temp: 'yukibie',
    smv: -20, acidity: 2.4, amino: 1.1, abv: 8, seimai: 65,
    profile: 'Featherlight and frothy, like a fresh-cut green apple over sea breeze.',
    tags: ['sparkling', 'green apple', 'briny', 'low alcohol'],
  },
  {
    id: 's2', name: 'Kaze Junmai Ginjo', romaji: '風 純米吟醸',
    brewery: 'Kaze Shuzō', region: 'Yamagata',
    grade: 'junmai_ginjo', type4: 'kunshu', temp: 'hanabie',
    smv: -2, acidity: 1.3, amino: 1.0, abv: 15, seimai: 55,
    profile: 'Pear blossom and white peach with a clean, cool finish.',
    tags: ['floral', 'white peach', 'pear', 'silky'],
  },
  {
    id: 's3', name: 'Ishibashi Junmai', romaji: '石橋 純米',
    brewery: 'Ishibashi Brewery', region: 'Niigata',
    grade: 'junmai', type4: 'junshu', temp: 'joon',
    smv: 3, acidity: 1.6, amino: 1.4, abv: 15, seimai: 65,
    profile: 'Warm steamed rice and toasted grain — gentle, savoury, grounding.',
    tags: ['umami', 'toasted rice', 'nutty', 'dry-ish'],
  },
  {
    id: 's4', name: 'Kurogane Kimoto Junmai', romaji: '鉄 生酛 純米',
    brewery: 'Kurogane Shuzō', region: 'Nagano',
    grade: 'junmai', type4: 'junshu', temp: 'nurukan',
    smv: 5, acidity: 1.9, amino: 1.6, abv: 16, seimai: 70,
    profile: 'Muscular and earthy — dried mushroom, brown spice, a long dry tail. Blooms when warmed.',
    tags: ['kimoto', 'earthy', 'umami', 'serve warm', 'bold'],
  },
  {
    id: 's5', name: 'Kohaku Koshu', romaji: '琥珀 古酒',
    brewery: 'Kohaku Brewery', region: 'Shimane',
    grade: 'koshu', type4: 'jukushu', temp: 'joon',
    smv: -4, acidity: 1.5, amino: 2.1, abv: 17, seimai: 60,
    profile: 'Amber and aged — salted caramel, walnut, dried apricot, a whisper of soy.',
    tags: ['aged', 'caramel', 'walnut', 'dessert', 'rich'],
  },
  {
    id: 's6', name: 'Momo Nigori', romaji: '桃 にごり',
    brewery: 'Momo Shuzō', region: 'Fukushima',
    grade: 'nigori', type4: 'soshu', temp: 'suzubie',
    smv: -15, acidity: 1.4, amino: 1.2, abv: 13, seimai: 65,
    profile: 'Cloudy and creamy — coconut, ripe peach, a soft sweet cushion.',
    tags: ['nigori', 'creamy', 'sweet', 'tames spice'],
  },
];

/* The personal journal — sake a guest logs on their own, outside any hosted event. Seeded on both
   server and client; hidden from the host's event list and never used as the "tonight" event. */
export const SOLO_EVENT = {
  id: 'solo',
  title: 'Your own tastings',
  subtitle: 'Sake you’ve logged on your own',
  theme: 'default',
  date: '',
  venue: '',
  host: 'Kana - Sake Journey',
  personal: true,
  published: false,
  courses: [],
};

export const SEED_EVENT = {
  id: 'evt-sake-west',
  title: 'Sake & the West',
  subtitle: 'A five-pour pairing dinner',
  theme: 'default',
  date: '2026-07-11',
  venue: 'The Cellar Room · Surry Hills',
  venueUrl: 'https://www.sake-journey.com/',
  venueImage: './assets/venue-sample.png',
  venueMenuUrl: '',
  venueReserveUrl: '',
  venueGoogleUrl: 'https://www.google.com/maps/search/?api=1&query=The+Cellar+Room+Surry+Hills',
  host: 'Kana - Sake Journey',
  optinPerk: '10% off your first bottle order',
  published: true,
  courses: [
    {
      id: 'c1', order: 1, name: 'Freshly Shucked Oysters',
      desc: 'Sydney rock oysters, yuzu-cucumber mignonette',
      sakeId: 's1',
      pairing: {
        move: 'mirror',
        text: 'Sake carries far more umami than wine, so it meets the oyster’s ocean-sweetness head-on instead of fighting it — and the fine bubbles scrub your palate clean between each shell.',
        host: 'I open every Western dinner here. It’s the pairing that makes people go "oh — I get it now."',
      },
    },
    {
      id: 'c2', order: 2, name: 'Burrata & Heirloom Tomato',
      desc: 'Torn basil, cold-pressed olive oil, sea salt',
      sakeId: 's2',
      pairing: {
        move: 'contrast',
        text: 'The ginjo’s floral lift bridges straight into the basil, while its quiet acidity cuts the richness of the burrata so the cream never sits heavy.',
        host: 'Aromatic sake + herbs is an underrated magic trick. Watch the peach note wake up the tomato.',
      },
    },
    {
      id: 'c3', order: 3, name: 'Pan-Seared Barramundi',
      desc: 'Brown butter, capers, charred lemon',
      sakeId: 's3',
      pairing: {
        move: 'mirror',
        text: 'Brown butter is all toasted, nutty umami — and so is this junmai. Same flavour family, echoing each other. Served at room temperature so the rice character sings.',
        host: 'A junmai at jō-on is my desert-island pour with anything nutty or buttery.',
      },
    },
    {
      id: 'c4', order: 4, name: 'Wagyu Striploin',
      desc: 'Bone-marrow jus, confit garlic, watercress',
      sakeId: 's4',
      pairing: {
        move: 'match',
        text: 'Fat makes sake taste drier and leaner, so a big, earthy kimoto stands shoulder-to-shoulder with the wagyu rather than being flattened. Warmed to nuru-kan, it wraps the beef in spice.',
        host: 'Warm sake with red meat surprises everyone. This is the pour people ask to buy.',
      },
    },
    {
      id: 'c5', order: 5, name: 'Comté & Burnt Honey Crème',
      desc: 'Aged Comté, burnt-honey crème brûlée, walnut',
      sakeId: 's5',
      pairing: {
        move: 'mirror',
        text: 'Aged koshu tastes of caramel and walnut — it mirrors the brûlée’s burnt sugar and loves the crystalline savour of aged cheese. A dessert and a digestif in one glass.',
        host: 'The finale. Aged sake with aged cheese is a duet older than either of us.',
      },
    },
  ],
};
