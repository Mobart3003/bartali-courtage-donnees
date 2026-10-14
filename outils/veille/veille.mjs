// Moteur de veille : collecte quotidienne des sources officielles → données du site.
// Usage : node outils/veille/veille.mjs [--date AAAA-MM-JJ] [--essai]
//   --essai : collecte et affiche sans rien écrire.
// Écrit : src/data/veille/indicateurs.json, src/data/veille/actualites.json,
//         src/static/assets/data/market-data.json (taux du simulateur),
//         suivi/veille/etat.json, suivi/veille/journal.jsonl, suivi/veille/derniere-execution.json
// Une source en échec ne bloque pas les autres ; sa dernière valeur reste datée et
// le générateur la retire de l'affichage dès qu'elle est périmée (outils/veille/regles.mjs).
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyserCreditsParticuliers, analyserTauxUsure, analyserTauxBce, analyserRss, analyserListeServicePublic, libelleMois } from './analyseurs.mjs';
import { estPertinente, fusionnerActualites, periodesCandidates, trimestre } from './regles.mjs';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const F = {
  indicateurs: join(RACINE, 'src/data/veille/indicateurs.json'),
  actualites: join(RACINE, 'src/data/veille/actualites.json'),
  marche: join(RACINE, 'src/static/assets/data/market-data.json'),
  etat: join(RACINE, 'suivi/veille/etat.json'),
  journal: join(RACINE, 'suivi/veille/journal.jsonl'),
  derniere: join(RACINE, 'suivi/veille/derniere-execution.json'),
};
const TAILLE_MAX = 3_000_000; // au-delà, la réponse est refusée (protection des analyseurs)
const SEUIL_ALERTE = 3; // échecs consécutifs d'une même source avant alerte
const args = process.argv.slice(2);
const ESSAI = args.includes('--essai');
const AUJOURDHUI = args.includes('--date') ? args[args.indexOf('--date') + 1] : new Date().toISOString().slice(0, 10);

const lireJson = (f, defaut) => existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : defaut;
const ecrireJson = (f, v) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(v, null, 2) + '\n'); };

async function telecharger(url) {
  let derniere;
  for (let essai = 0; essai < 2; essai++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'BartaliCourtage-Veille/1.0 (+https://bartali-courtage.fr)' }, signal: AbortSignal.timeout(25000) });
      if (r.status === 404 || r.status === 403) return null; // la Banque de France répond 403 pour une page non encore publiée
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const texte = await r.text();
      if (texte.length > TAILLE_MAX) throw new Error(`réponse trop volumineuse (${texte.length} caractères)`);
      return texte;
    } catch (e) { derniere = e; await new Promise(res => setTimeout(res, 3000)); }
  }
  throw new Error(`${url} : ${derniere.message}`);
}

const SOURCES = {
  async tauxMoyen() {
    for (const periode of periodesCandidates(AUJOURDHUI)) {
      const url = `https://www.banque-france.fr/fr/statistiques/credit/credits-aux-particuliers-${periode}`;
      const html = await telecharger(url);
      if (!html) continue;
      const r = analyserCreditsParticuliers(html, periode);
      return { valeur: r.valeur, periode: r.periode, relais: r.relais, historique: r.historique, source: 'Banque de France — Crédits aux particuliers', sourceUrl: url };
    }
    throw new Error('aucune publication mensuelle trouvée sur les 4 derniers mois');
  },
  async usure() {
    const { annee, t } = trimestre(AUJOURDHUI);
    const url = `https://www.banque-france.fr/fr/statistiques/taux-et-cours/taux-dusure-${annee}-q${t}`;
    const html = await telecharger(url);
    if (!html) throw new Error(`publication du trimestre ${annee}-T${t} absente`);
    return { ...analyserTauxUsure(html), source: "Banque de France — Taux d'usure", sourceUrl: url };
  },
  async bce() {
    const url = 'https://data-api.ecb.europa.eu/service/data/FM/D.U2.EUR.4F.KR.DFR.LEV?lastNObservations=400&format=csvdata';
    const csv = await telecharger(url);
    if (!csv) throw new Error('série BCE introuvable');
    return { ...analyserTauxBce(csv), source: 'Banque centrale européenne — taux de la facilité de dépôt', sourceUrl: 'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/key_ecb_interest_rates/html/index.fr.html' };
  },
};

const ecartJours = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
// Évite de republier le site chaque jour pour une simple vérification sans changement :
// la date de détection est conservée tant que la valeur ne change pas, et la date
// d'observation BCE n'avance qu'une fois par semaine (marge de validité : 21 jours).
function stabiliser(id, avant, apres) {
  const memeValeur = avant && JSON.stringify({ ...avant, detecteLe: 0, observeLe: 0, historique: 0 }) === JSON.stringify({ ...apres, detecteLe: 0, observeLe: 0, historique: 0 });
  const v = { ...apres, detecteLe: memeValeur && avant.detecteLe ? avant.detecteLe : AUJOURDHUI };
  if (id === 'bce' && memeValeur && avant.observeLe && ecartJours(avant.observeLe, apres.observeLe) < 7) v.observeLe = avant.observeLe;
  return v;
}

const FLUX = [
  { id: 'service-public', nom: 'Service-Public.gouv.fr', url: 'https://www.service-public.gouv.fr/abonnements/rss/actu-actualites-particuliers.rss', analyser: analyserRss },
  { id: 'service-public-liste', nom: 'Service-Public.gouv.fr', url: 'https://www.service-public.gouv.fr/particuliers/actualites', analyser: analyserListeServicePublic },
  { id: 'economie-gouv', nom: 'economie.gouv.fr', url: 'https://www.economie.gouv.fr/rss/toutesactualites', analyser: analyserRss },
];

async function executer() {
  const indicateurs = lireJson(F.indicateurs, {});
  const actualites = lireJson(F.actualites, []);
  const etat = lireJson(F.etat, { sources: {} });
  const rapport = { date: AUJOURDHUI, debut: new Date().toISOString(), sources: {}, nouveautes: [], changements: false, alerte: false };
  const noter = (id, ok, detail) => {
    const s = etat.sources[id] ?? { echecsConsecutifs: 0 };
    etat.sources[id] = ok ? { dernierSucces: AUJOURDHUI, echecsConsecutifs: 0 } : { ...s, echecsConsecutifs: s.echecsConsecutifs + 1, derniereErreur: detail, derniereErreurLe: AUJOURDHUI };
    rapport.sources[id] = ok ? 'ok' : `échec : ${detail}`;
  };

  const nouveauxInd = { ...indicateurs };
  for (const [id, collecter] of Object.entries(SOURCES)) {
    try {
      const v = await collecter();
      if (id === 'tauxMoyen' && indicateurs.tauxMoyen) {
        // Conserve l'historique accumulé (12 derniers mois au plus), les révisions de la source font foi.
        const hist = new Map((indicateurs.tauxMoyen.historique ?? []).map(h => [h.periode, h.valeur]));
        for (const h of v.historique) hist.set(h.periode, h.valeur);
        v.historique = [...hist].sort(([a], [b]) => a.localeCompare(b)).slice(-13).map(([periode, valeur]) => ({ periode, valeur }));
      }
      nouveauxInd[id] = stabiliser(id, indicateurs[id], v);
      noter(id, true);
    } catch (e) { noter(id, false, e.message); }
  }

  let nouvelles = [];
  for (const flux of FLUX) {
    try {
      const xml = await telecharger(flux.url);
      if (!xml) throw new Error('flux introuvable (404)');
      nouvelles = nouvelles.concat(flux.analyser(xml).filter(estPertinente).map(a => ({ ...a, source: flux.nom })));
      noter(flux.id, true);
    } catch (e) { noter(flux.id, false, e.message); }
  }
  const fusion = fusionnerActualites(actualites, nouvelles, AUJOURDHUI);
  const anciennes = new Set(actualites.map(a => a.id));
  rapport.nouveautes = fusion.filter(a => !anciennes.has(a.id)).map(a => `${a.date} · ${a.titre}`);

  const indChange = JSON.stringify(nouveauxInd) !== JSON.stringify(indicateurs);
  const actuChange = JSON.stringify(fusion) !== JSON.stringify(actualites);
  rapport.changements = indChange || actuChange;
  rapport.alerte = Object.values(etat.sources).some(s => s.echecsConsecutifs >= SEUIL_ALERTE);
  rapport.fin = new Date().toISOString();
  etat.derniereExecution = rapport.fin;

  if (ESSAI) { console.log(JSON.stringify({ rapport, indicateurs: nouveauxInd, actualitesRetenues: fusion.length }, null, 2)); return rapport; }

  if (indChange) ecrireJson(F.indicateurs, nouveauxInd);
  if (actuChange) ecrireJson(F.actualites, fusion);
  // Le simulateur suit aussi une révision de valeur pour une même période (cartes et simulateur toujours identiques).
  const tauxChange = nouveauxInd.tauxMoyen && (nouveauxInd.tauxMoyen.periode !== indicateurs.tauxMoyen?.periode || nouveauxInd.tauxMoyen.valeur !== indicateurs.tauxMoyen?.valeur);
  if (tauxChange) mettreAJourSimulateur(nouveauxInd.tauxMoyen);
  ecrireJson(F.etat, etat);
  ecrireJson(F.derniere, rapport);
  mkdirSync(dirname(F.journal), { recursive: true });
  appendFileSync(F.journal, JSON.stringify({ date: AUJOURDHUI, fin: rapport.fin, changements: rapport.changements, alerte: rapport.alerte, sources: rapport.sources, nouveautes: rapport.nouveautes.length }) + '\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changements=${rapport.changements}\nalerte=${rapport.alerte}\ntaux_change=${Boolean(tauxChange)}\n`);
  console.log(`Veille ${AUJOURDHUI} : ${Object.entries(rapport.sources).map(([k, v]) => `${k}=${v}`).join(' | ')}`);
  console.log(`${rapport.nouveautes.length} nouvelle(s) actualité(s) ; changements du site : ${rapport.changements ? 'oui' : 'non'} ; alerte : ${rapport.alerte ? 'OUI' : 'non'}`);
  return rapport;
}

// Le taux indicatif du simulateur et des pages villes suit la publication Banque de France.
function mettreAJourSimulateur(t) {
  const m = lireJson(F.marche, {});
  m._comment = 'Mis à jour automatiquement par outils/veille/veille.mjs à partir de la publication mensuelle de la Banque de France. Seul indicativeMortgageRate est utilisé (simulateur et exemples des pages villes).';
  m.generatedAt = new Date().toISOString();
  m.indicativeMortgageRate = {
    value: t.valeur,
    label: 'Taux moyen indicatif (marché, hors assurance)',
    date: `${t.periode}-${new Date(Date.UTC(...t.periode.split('-').map(Number), 0)).getUTCDate()}`,
    periodLabel: libelleMois(t.periode),
    source: "Banque de France — Crédits aux particuliers (taux des crédits nouveaux à l'habitat, hors renégociations)",
    sourceUrl: t.sourceUrl,
  };
  ecrireJson(F.marche, m);
}

executer().catch(e => { console.error('Erreur fatale de la veille :', e); process.exit(1); });
