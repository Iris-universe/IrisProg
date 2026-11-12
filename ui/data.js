// Constantes, icônes et données d'exemple.
const STATUSES = [
  { k: 'proposition', l: 'Proposition' },
  { k: 'shortlist', l: 'Shortlist' },
  { k: 'contacte', l: 'Contacté' },
  { k: 'negociation', l: 'En négo' },
  { k: 'confirme', l: 'Confirmé' },
  { k: 'refuse', l: 'Refusé' },
];
const STATUS_L = Object.fromEntries(STATUSES.map((s) => [s.k, s.l]));

const DEFAULT_STYLES = ['Rap / Hip-hop', 'Pop', 'Rock / Indie', 'Électro', 'Techno', 'House', 'Hardcore / Uptempo', 'DnB / Bass', 'Punk / Métal', 'R&B / Soul', 'Afro / Amapiano', 'Reggae / Dub', 'Jazz / Funk', 'Chanson', 'Musiques du monde', 'Expérimental'];
// Couleurs d'identification des styles (toujours accompagnées du nom)
const STYLE_COLORS = ['#3b7cf6', '#e5484d', '#12a594', '#f5a524', '#8e4ec6', '#e54d9c', '#0d9fc4', '#46a758', '#f76b15', '#6e56cf', '#a18072', '#5b6b85', '#d6409f', '#29a383', '#ca8a04', '#7c66dc'];
const FOUND_VIA = ['Formulaire du site', 'Mail reçu', 'Agence / booker', 'Proposé par le comité', 'Repéré en concert', 'Repéré sur le web / réseaux', 'Recommandation', 'Coup de cœur perso', 'Autre'];
const FORMATIONS = ['Solo', 'DJ', 'Duo', 'Groupe', 'Collectif', 'B2B'];
const CURRENCIES = ['CHF', 'EUR', 'USD', 'GBP'];
const COUNTRIES = ['Suisse', 'France', 'Belgique', 'Allemagne', 'Italie', 'Espagne', 'Portugal', 'Royaume-Uni', 'Irlande', 'Pays-Bas', 'Autriche', 'Luxembourg', 'Suède', 'Norvège', 'Danemark', 'Finlande', 'Islande', 'Pologne', 'Tchéquie', 'Hongrie', 'Grèce', 'Croatie', 'Serbie', 'Roumanie', 'Bulgarie', 'Ukraine', 'Turquie', 'États-Unis', 'Canada', 'Mexique', 'Brésil', 'Argentine', 'Colombie', 'Chili', 'Cuba', 'Jamaïque', 'Sénégal', 'Mali', "Côte d'Ivoire", 'Nigeria', 'Ghana', 'Cameroun', 'RD Congo', 'Afrique du Sud', 'Maroc', 'Algérie', 'Tunisie', 'Égypte', 'Liban', 'Israël', 'Iran', 'Inde', 'Japon', 'Corée du Sud', 'Chine', 'Australie', 'Nouvelle-Zélande'];

const DEFAULT_SETTINGS = {
  edition: 'Mon festival 2027',
  dateStart: '', dateEnd: '',
  budget: 0,
  slots: 0,
  styles: DEFAULT_STYLES,
  rates: { CHF: 1, EUR: 0.93, USD: 0.8, GBP: 1.06 },
  theme: '',
};

const TEMPLATES = [
  { k: 'dispo', l: "Demande de disponibilité / offre", subject: '{festival} – Demande de disponibilité pour {artiste}',
    body: "Bonjour,\n\nJe suis en charge de la programmation du festival {festival}, qui aura lieu {dates} à Genève.\n\nNous serions ravis d'accueillir {artiste} cette année. Pourriez-vous me dire si l'artiste est disponible à ces dates, ainsi que ses conditions (cachet, fiche technique, besoins d'hébergement et de transport) ?\n\nN'hésitez pas à me contacter pour toute question.\n\nBelle journée," },
  { k: 'refus', l: 'Réponse négative (polie)', subject: 'Re: {artiste} – {festival}',
    body: "Bonjour,\n\nMerci beaucoup pour votre proposition concernant {artiste} et pour l'intérêt porté au festival.\n\nAprès réflexion, nous ne pourrons malheureusement pas l'intégrer à notre programmation cette année. Nous gardons le projet en tête pour de prochaines éditions.\n\nBelle continuation," },
  { k: 'confirm', l: 'Confirmation de booking', subject: 'Confirmation – {artiste} au {festival}',
    body: "Bonjour,\n\nC'est avec grand plaisir que nous confirmons la venue de {artiste} au festival {festival} ({dates}).\n\nNous revenons très vite vers vous avec le contrat, le planning et les informations pratiques (accueil, hébergement, technique).\n\nÀ très bientôt," },
  { k: 'infos', l: "Demande d'infos (EPK, rider)", subject: '{artiste} – demande d’informations',
    body: "Bonjour,\n\nMerci pour votre message. Pour étudier la proposition, pourriez-vous nous envoyer le dossier de presse (EPK), la fiche technique, le cachet demandé ainsi que les éventuels frais annexes ?\n\nMerci d'avance et belle journée," },
];

const P = {
  dash: '<rect x="3.5" y="3.5" width="7" height="8" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.5"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.5"/><rect x="3.5" y="14.5" width="7" height="6" rx="1.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M15.5 4.8a3.3 3.3 0 0 1 0 6.4M17.5 14.8c2.2.6 3.6 2.4 4 5.2"/>',
  board: '<rect x="3" y="4" width="5" height="15" rx="1.5"/><rect x="9.5" y="4" width="5" height="9" rx="1.5"/><rect x="16" y="4" width="5" height="12" rx="1.5"/>',
  mail: '<rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12.5a2 2 0 0 0 2 1.5h7a2 2 0 0 0 2-1.5l1-12.5M9 7V4.5h6V7"/>',
  pin: '<path d="M12 21s-7-6.1-7-11.5A7 7 0 0 1 19 9.5C19 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  music: '<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  spotify: '<circle cx="12" cy="12" r="9.5"/><path d="M7 9.5c3.5-1 7.5-.6 10.5 1M7.8 12.8c2.8-.7 5.8-.4 8.2 1M8.5 15.8c2.2-.5 4.3-.3 6 .7"/>',
  instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17 7h.01"/>',
  youtube: '<rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="m10 9.5 5 2.5-5 2.5z"/>',
  soundcloud: '<path d="M8 17.5h10a3.5 3.5 0 0 0 .5-7 5.5 5.5 0 0 0-10.5-1.5"/><path d="M3.5 13v4.5M6 10.5v7"/>',
  facebook: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M15.5 8h-2a2 2 0 0 0-2 2v10.5M9 13h6"/>',
  tiktok: '<path d="M14 3.5v11a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14 3.5c.5 2.6 2.2 4.2 5 4.5"/>',
  globe: '<circle cx="12" cy="12" r="9.5"/><ellipse cx="12" cy="12" rx="4" ry="9.5"/><path d="M3 12h18"/>',
  phone: '<path d="M5 3.5h3.5l1.5 4.5-2.2 1.4a11 11 0 0 0 6.8 6.8l1.4-2.2 4.5 1.5V19a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.1 1.5 1.5 0 0 1 5 3.5z"/>',
  reply: '<path d="M9.5 6.5 4 12l5.5 5.5"/><path d="M4 12h10a6 6 0 0 1 6 6v1"/>',
  forward: '<path d="M14.5 6.5 20 12l-5.5 5.5"/><path d="M20 12H10a6 6 0 0 0-6 6v1"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8"/><path d="M4 3.5V8h4.5"/><path d="M4 13a8 8 0 0 0 14.6 4.5L20 16"/><path d="M20 20.5V16h-4.5"/>',
  clip: '<path d="m20 11.5-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.2a1.7 1.7 0 0 1-2.4-2.4L15 7"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  envopen: '<path d="M3 10 12 4l9 6v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5z"/><path d="m3 10 9 6 9-6"/>',
  download: '<path d="M12 3.5v12M7 10.5l5 5 5-5M4.5 20.5h15"/>',
  upload: '<path d="M12 15.5v-12M7 8.5l5-5 5 5M4.5 20.5h15"/>',
  sparkle: '<path d="M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7z"/><path d="M19 15.5c.3 1.9 1 2.6 2.5 2.9-1.5.3-2.2 1-2.5 2.9-.3-1.9-1-2.6-2.5-2.9 1.5-.3 2.2-1 2.5-2.9z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  file: '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5"/>',
  inbox: '<path d="M3.5 13.5 6 5h12l2.5 8.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19z"/><path d="M3.5 13.5h5l1 2.5h5l1-2.5h5"/>',
  send: '<path d="M21 3 10 14"/><path d="M21 3 14.5 21l-4.5-7-7-4.5z"/>',
  folder: '<path d="M3.5 7a2 2 0 0 1 2-2H10l2 2.5h6.5a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c.8-4 3.8-6 7.5-6s6.7 2 7.5 6"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  money: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.8"/><path d="M6 9.5v5M18 9.5v5"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  checksq: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="m8 12.5 3 3 5.5-6"/>',
  play: '<path d="M7 4.5v15l12.5-7.5z"/>',
  minus: '<path d="M5 12h14"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z"/>',
  archive: '<rect x="3" y="4" width="18" height="4.5" rx="1"/><path d="M5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V8.5M10 12.5h4"/>',
  spam: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  draft: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  unlink: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4"/><path d="M4 4l16 16"/>',
};
const ic = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[n] || ''}</svg>`;
const STAR = 'M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z';

// Exemples fictifs, pour voir le logiciel rempli (supprimables d'un clic dans Paramètres).
const EXAMPLES = [
  { name: 'Grand Fracas', styles: ['Punk / Métal', 'Rock / Indie'], country: 'Suisse', city: 'Genève', formation: 'Groupe', status: 'shortlist', priority: 3,
    bio: "Quatuor genevois qui mélange punk rapide et refrains à chanter en chœur. Gros succès sur la scène locale, réputé pour ses concerts très physiques et son public fidèle.", source: 'Proposé par le comité',
    fee: { amount: 1800, currency: 'CHF', type: 'fixe', includes: { transport: true } }, contact: { name: 'Léa M.', email: 'booking@grandfracas.example' }, listeners: 8400 },
  { name: 'Sora Vex', styles: ['Techno'], country: 'Allemagne', city: 'Berlin', formation: 'DJ', status: 'negociation', priority: 3,
    bio: "DJ et productrice berlinoise, sets techno hypnotiques et percussifs. Résidente d'un club de Friedrichshain, elle tourne beaucoup en Europe depuis deux ans.", source: 'Agence Nordlicht',
    fee: { amount: 4500, max: 6000, currency: 'EUR', type: 'fourchette', includes: { hebergement: true, transport: true } }, contact: { agency: 'Nordlicht Booking', name: 'Jonas K.', email: 'jonas@nordlicht.example' }, listeners: 61000 },
  { name: 'Rimbo 22', styles: ['Rap / Hip-hop'], country: 'France', city: 'Marseille', formation: 'Solo', status: 'contacte', priority: 2,
    bio: "Rappeur marseillais à l'écriture imagée, entre egotrip et récits de quartier. Premier album sorti au printemps, plusieurs titres en playlists éditoriales.", source: 'Mail reçu',
    fee: { amount: 7000, currency: 'EUR', type: 'fixe', includes: { hebergement: true } }, contact: { agency: 'Sud Live', email: 'prog@sudlive.example' }, listeners: 240000 },
  { name: 'Tamaru', styles: ['Afro / Amapiano', 'House'], country: 'Sénégal', city: 'Dakar', formation: 'DJ', status: 'proposition', priority: 2,
    bio: "DJ dakarois qui fait le pont entre amapiano, afro-house et rythmes mbalax. Sets très dansants, idéal pour la fin de soirée.", source: 'Candidature spontanée',
    fee: { type: 'negocier', currency: 'EUR' }, contact: { email: 'tamaru.music@example.com' }, listeners: 15200 },
  { name: 'Kestrel & The Tides', styles: ['Rock / Indie', 'Pop'], country: 'Royaume-Uni', city: 'Bristol', formation: 'Groupe', status: 'proposition', priority: 1,
    bio: "Indie pop à guitares, mélodies lumineuses et voix à deux. Le groupe prépare une tournée européenne au printemps 2027.", source: 'Agence Harbour Music',
    fee: { amount: 3500, currency: 'GBP', type: 'fixe', includes: { transport: false } }, contact: { agency: 'Harbour Music', email: 'eu@harbourmusic.example' }, listeners: 92000 },
  { name: 'Nayla Rhodes', styles: ['R&B / Soul'], country: 'Belgique', city: 'Bruxelles', formation: 'Solo', status: 'confirme', priority: 3,
    bio: "Chanteuse soul/R&B bruxelloise, voix chaude et groupe live de quatre musiciens. Remarquée sur plusieurs festivals belges l'été dernier.", source: 'Agence Velours',
    fee: { amount: 5200, currency: 'EUR', type: 'fixe', includes: { hebergement: true, catering: true } }, contact: { agency: 'Velours Prod', name: 'Ines D.', email: 'ines@velours.example' }, listeners: 130000 },
  { name: 'Vortex Uptempo Crew', styles: ['Hardcore / Uptempo'], country: 'Pays-Bas', city: 'Rotterdam', formation: 'Collectif', status: 'shortlist', priority: 2,
    bio: "Collectif de trois DJs hardcore/uptempo de Rotterdam. Sets à plus de 200 BPM, très appréciés pour clôturer les nuits.", source: 'Proposé par le comité',
    fee: { amount: 2500, currency: 'EUR', type: 'fixe' }, contact: { email: 'vortex.crew@example.com' }, listeners: 27000 },
  { name: 'Ondine Saez', styles: ['Jazz / Funk', 'R&B / Soul'], country: 'Espagne', city: 'Barcelone', formation: 'Groupe', status: 'refuse', priority: 1,
    bio: "Sextet jazz-funk emmené par une saxophoniste. Musique très live, cuivres et grooves. Refusé cette année faute de créneau adapté.", source: 'Mail reçu',
    fee: { amount: 4000, currency: 'EUR', type: 'fixe' }, contact: { email: 'ondine.booking@example.com' } },
  { name: 'Maëlys Orno', styles: ['Chanson', 'Pop'], country: 'France', city: 'Lyon', formation: 'Solo', status: 'proposition', priority: 1,
    bio: "Chanson pop en français, textes intimes et production électronique légère. Premier EP sorti en 2026.", source: 'Candidature spontanée',
    fee: { amount: 1500, currency: 'EUR', type: 'fixe' }, contact: { email: 'maelys.orno@example.com' }, listeners: 5600 },
  { name: 'Lowkey Atlas', styles: ['DnB / Bass', 'Électro'], country: 'Suisse', city: 'Lausanne', formation: 'Duo', status: 'contacte', priority: 2,
    bio: "Duo lausannois drum & bass / bass music, sets énergiques avec MC. Très demandé dans les soirées étudiantes romandes.", source: 'Proposé par le comité',
    fee: { amount: 1200, currency: 'CHF', type: 'fixe' }, contact: { email: 'lowkeyatlas@example.com' }, listeners: 11000 },
];
