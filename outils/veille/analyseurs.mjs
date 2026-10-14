// Analyseurs purs (sans réseau) des sources officielles de la veille.
// Chaque fonction reçoit le texte brut d'une source et renvoie des données validées,
// ou lève une ErreurSource : une donnée douteuse n'est jamais retenue.

export class ErreurSource extends Error {}

const MOIS = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
const MOIS_LONGS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

export const nombreFr = s => Number(String(s).replace(/\s/g, '').replace(',', '.'));

export function decoderEntites(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ').replace(/&euro;/g, '€').replace(/&rsquo;/g, '’').replace(/&laquo;/g, '«').replace(/&raquo;/g, '»')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// Retire les blocs <script> et <style> en un seul passage (temps linéaire, même si une balise n'est pas fermée).
function retirerBlocs(html, balise) {
  const bas = html.toLowerCase(), ouvre = `<${balise}`, ferme = `</${balise}>`;
  let sortie = '', pos = 0;
  for (;;) {
    const debut = bas.indexOf(ouvre, pos);
    if (debut < 0) return sortie + html.slice(pos);
    sortie += html.slice(pos, debut) + ' ';
    const fin = bas.indexOf(ferme, debut);
    if (fin < 0) return sortie; // bloc non fermé : le reste est ignoré
    pos = fin + ferme.length;
  }
}

// Texte d'une page HTML. Expressions bornées : une page malformée ne peut pas provoquer de calcul explosif.
export const texteBrut = html => decoderEntites(retirerBlocs(retirerBlocs(String(html), 'script'), 'style')
  .replace(/<[^<>]{0,3000}>/g, ' ')).replace(/\s+/g, ' ').trim();

// Date AAAA-MM-JJ réellement existante (refuse 2026-00-10, 2026-02-30…).
export const dateValide = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
  && !isNaN(new Date(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

// Seuls les liens vers ces sites officiels peuvent être publiés automatiquement sur le site.
export const HOTES_AUTORISES = new Set(['www.service-public.gouv.fr', 'www.economie.gouv.fr']);
export function lienAutorise(u) {
  try { const x = new URL(u); return x.protocol === 'https:' && HOTES_AUTORISES.has(x.hostname); } catch { return false; }
}
function sansParametreDeSuivi(u) {
  try { const x = new URL(u); x.searchParams.delete('xtor'); return x.toString(); } catch { return u; }
}

export const libelleMois = periode => { const [a, m] = periode.split('-').map(Number); return `${MOIS_LONGS[m - 1]} ${a}`; };

// --- Banque de France : « Crédits aux particuliers » (publication mensuelle) ---
// Retient le taux moyen des crédits nouveaux à l'habitat hors renégociations.
// Double contrôle : la valeur du tableau (dernière colonne) doit égaler celle de la phrase de synthèse.
export function analyserCreditsParticuliers(html, periodeAttendue) {
  const t = texteBrut(html);
  const entete = t.match(/\(En pourcentage\)\s*((?:[a-zéû]+\.?-\s*\d{4}\s*(?:\([rp]\))?\s*){4})/i);
  if (!entete) throw new ErreurSource('tableau des taux introuvable');
  const colonnes = [...entete[1].matchAll(/([a-zéû]+)\.?-\s*(\d{4})/gi)].map(([, m, a]) => {
    const jeton = m.toLowerCase();
    const i = MOIS.findIndex(x => jeton.startsWith(x) || x.startsWith(jeton));
    if (i < 0) throw new ErreurSource(`mois illisible : ${m}`);
    return `${a}-${String(i + 1).padStart(2, '0')}`;
  });
  const apres = t.slice(entete.index);
  const ligne = apres.match(/dont crédits à l'habitat hors renégociations\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)/i);
  if (!ligne) throw new ErreurSource('ligne « hors renégociations » introuvable');
  const valeurs = ligne.slice(1, 5).map(nombreFr);
  if (valeurs.some(v => !(v > 0.3 && v < 9))) throw new ErreurSource(`valeurs hors plage : ${valeurs}`);
  const periode = colonnes[3];
  if (periodeAttendue && periode !== periodeAttendue) throw new ErreurSource(`période ${periode} ≠ ${periodeAttendue}`);
  const synthese = t.match(/hors renégociations\)[^.%]{0,80}?(\d+,\d+)\s*%/i);
  if (!synthese || nombreFr(synthese[1]) !== valeurs[3]) throw new ErreurSource('la synthèse ne confirme pas la valeur du tableau');
  // Taux moyen des crédits relais (même tableau) : facultatif, retenu seulement s'il est lisible et plausible.
  const lr = apres.match(/dont crédits relais\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)/i);
  const relais = lr ? nombreFr(lr[4]) : null;
  return {
    valeur: valeurs[3], periode,
    relais: relais > 0.3 && relais < 12 ? relais : null,
    historique: colonnes.map((p, i) => ({ periode: p, valeur: valeurs[i] })),
  };
}

// --- Banque de France : taux d'usure (publication trimestrielle) ---
// Contrôle de cohérence : usure = taux effectif moyen × 4/3 (art. L314-6 C. conso), à 0,02 point près.
export function analyserTauxUsure(html) {
  const t = texteBrut(html);
  const app = t.match(/Taux d'usure applicable au (1er|\d{1,2}) ([a-zéû]+) (\d{4})/i);
  if (!app) throw new ErreurSource("date d'application introuvable");
  const mois = MOIS_LONGS.indexOf(app[2].toLowerCase());
  if (mois < 0) throw new ErreurSource(`mois illisible : ${app[2]}`);
  const applicableDepuis = `${app[3]}-${String(mois + 1).padStart(2, '0')}-${app[1] === '1er' ? '01' : app[1].padStart(2, '0')}`;
  const immo = t.slice(t.search(/CRÉDITS IMMOBILIERS/i));
  if (immo.length < 20) throw new ErreurSource('section crédits immobiliers introuvable');
  const lire = (motif) => {
    const m = immo.match(motif);
    if (!m) throw new ErreurSource(`catégorie introuvable : ${motif}`);
    const tem = nombreFr(m[1]), usure = nombreFr(m[2]);
    if (!(usure > 1 && usure < 15) || Math.abs(usure - tem * 4 / 3) > 0.02) throw new ErreurSource(`incohérence usure ${usure} / TEM ${tem}`);
    return { tem, usure };
  };
  return {
    applicableDepuis,
    vingtAnsEtPlus: lire(/taux fixe d'une durée de 20 ans et plus\s+([\d,]+)\s+([\d,]+)/i),
    dixAVingtAns: lire(/taux fixe d'une durée comprise entre 10 ans et moins de 20 ans\s+([\d,]+)\s+([\d,]+)/i),
  };
}

// --- BCE : taux de la facilité de dépôt (taux directeur de référence), CSV de l'API SDMX ---
export function analyserTauxBce(csv) {
  const lignes = String(csv).trim().split(/\r?\n/);
  const entetes = lignes.shift()?.split(',') ?? [];
  const iP = entetes.indexOf('TIME_PERIOD'), iV = entetes.indexOf('OBS_VALUE');
  if (iP < 0 || iV < 0) throw new ErreurSource('format CSV BCE inattendu');
  // Une valeur vide n'est pas un zéro (Number('') vaut 0) : seules les valeurs numériques explicites sont retenues.
  const obs = lignes.map(l => l.split(',')).map(c => ({ date: c[iP], brut: (c[iV] ?? '').trim(), valeur: Number(c[iV]) }))
    .filter(o => dateValide(o.date) && /^-?\d+(\.\d+)?$/.test(o.brut) && Number.isFinite(o.valeur)).sort((a, b) => a.date.localeCompare(b.date));
  if (!obs.length) throw new ErreurSource('aucune observation BCE');
  const dernier = obs.at(-1);
  if (!(dernier.valeur > -1 && dernier.valeur < 10)) throw new ErreurSource(`valeur BCE hors plage : ${dernier.valeur}`);
  let depuis = dernier.date;
  for (let i = obs.length - 1; i >= 0 && obs[i].valeur === dernier.valeur; i--) depuis = obs[i].date;
  // Si toute la fenêtre a la même valeur, la date du changement est inconnue : on ne l'affiche pas.
  const changementConnu = obs[0].valeur !== dernier.valeur;
  return { valeur: dernier.valeur, observeLe: dernier.date, depuis: changementConnu ? depuis : null };
}

// --- Flux RSS 2.0 (service-public.gouv.fr, economie.gouv.fr) ---
export function analyserRss(xml) {
  const items = [...String(xml).matchAll(/<item\b[^>]{0,500}>([\s\S]{0,20000}?)<\/item>/gi)].map(([, c]) => {
    const champ = n => { const m = c.match(new RegExp(`<${n}\\b[^>]{0,500}>([\\s\\S]{0,10000}?)<\\/${n}>`, 'i')); return m ? decoderEntites(m[1]).trim() : ''; };
    const dateBrute = champ('dc:date') || champ('pubDate');
    // Date locale de publication : la partie AAAA-MM-JJ si elle est explicite, sinon conversion à l'heure de Paris.
    const date = /^\d{4}-\d{2}-\d{2}/.test(dateBrute) ? dateBrute.slice(0, 10)
      : dateBrute && !isNaN(new Date(dateBrute)) ? new Date(dateBrute).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }) : null;
    return {
      titre: texteBrut(champ('title')),
      lien: sansParametreDeSuivi(champ('link')),
      resume: texteBrut(champ('description')).slice(0, 400),
      date,
      guid: champ('guid') || champ('link'),
    };
  });
  if (!items.length) throw new ErreurSource('flux RSS sans élément');
  return items.filter(i => i.titre && lienAutorise(i.lien) && dateValide(i.date));
}

// --- Service-Public : page « Actualités » des particuliers (cartes avec thème et date) ---
// Couvre plusieurs semaines, là où le flux RSS ne donne que les 10 dernières actualités.
export function analyserListeServicePublic(html) {
  // Segments bornés : si la page change de structure, l'analyse échoue vite au lieu de bloquer (pas de ReDoS).
  const re = /href="(https:\/\/www\.service-public\.gouv\.fr\/particuliers\/actualites\/(A\d+))"[^>]{0,300}>([^<]{1,400})<\/a>[\s\S]{0,1500}?Publié le (\d{1,2}) ([a-zéû]+) (\d{4})[\s\S]{0,1500}?carte-badge">([^<]{0,200})</gi;
  const vus = new Set(), items = [];
  for (const [, lien, id, titre, j, mois, a, theme] of String(html).matchAll(re)) {
    const m = MOIS_LONGS.indexOf(mois.toLowerCase());
    const date = m < 0 ? '' : `${a}-${String(m + 1).padStart(2, '0')}-${j.padStart(2, '0')}`;
    if (m < 0 || vus.has(id) || !dateValide(date)) continue;
    vus.add(id);
    items.push({ titre: texteBrut(titre), lien, resume: `Thème : ${decoderEntites(theme).trim()}`, date, guid: id });
  }
  if (!items.length) throw new ErreurSource('aucune carte d’actualité reconnue');
  return items;
}
