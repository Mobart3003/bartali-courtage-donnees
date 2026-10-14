// Règles de pertinence et de fraîcheur de la veille (pures, testées).
// Utilisées par la collecte (outils/veille/veille.mjs) ET par le générateur du site :
// une donnée périmée n'est jamais affichée, même si la collecte s'est arrêtée.

// Une actualité est retenue si son score atteint 2 : un mot fort suffit, deux mots faibles aussi.
const MOTS_FORTS = [
  /immobili/i, /prêts? immobiliers?/i, /crédits? immobiliers?/i, /\bPTZ\b/, /prêt à taux zéro/i, /notaire/i,
  /droits? de mutation/i, /\bDPE\b/, /performance énergétique/i, /copropriét/i, /acquéreur/i, /propriétaires?\b/i,
  /MaPrimeR[ée]nov/i, /assurance (?:de prêt|emprunteur)/i, /taux d'usure/i, /\bHCSF\b/, /plus-value immobili/i,
  /taxe foncière/i, /épargne logement/i, /\bPEL\b/, /primo-accédant/i, /bail réel solidaire/i, /\bLMNP\b/,
  /location meublée/i, /meublés? de tourisme/i, /passoires? (?:thermiques|énergétiques)/i, /accession à la propriété/i,
];
const MOTS_FAIBLES = [/logements?\b/i, /loyers?\b/i, /locat(?:aire|ion)/i, /travaux/i, /rénovation/i, /\bbail\b/i, /emprunt/i, /crédit/i, /banque/i];
// Sujets hors cible même s'ils citent le logement (énergie au quotidien, consommation, emploi).
const EXCLUSIONS = [/prix repère.*gaz/i, /carburant/i, /chèque énergie/i, /arrêt de travail/i, /titres?-restaurant/i, /Urssaf/i];

export function scorePertinence({ titre = '', resume = '' }) {
  const texte = `${titre} ${resume}`;
  if (EXCLUSIONS.some(r => r.test(titre))) return 0;
  return MOTS_FORTS.filter(r => r.test(texte)).length * 2 + MOTS_FAIBLES.filter(r => r.test(texte)).length;
}
export const estPertinente = a => scorePertinence(a) >= 2;

export function categorie({ titre = '', resume = '' }) {
  const t = `${titre} ${resume}`;
  if (/prêt|crédit|PTZ|usure|HCSF|assurance (?:de prêt|emprunteur)|emprunt/i.test(t)) return 'Financement';
  if (/notaire|mutation|plus-value|taxe foncière|achat|acquéreur|vente/i.test(t)) return 'Achat et fiscalité';
  if (/DPE|énergétique|rénovation|MaPrimeR|travaux|passoire/i.test(t)) return 'Logement et énergie';
  if (/loyer|locat|bail|meublé|LMNP/i.test(t)) return 'Location';
  return 'Logement';
}

const jour = d => new Date(`${String(d).slice(0, 10)}T00:00:00Z`);
const ajouterJours = (d, n) => new Date(jour(d).getTime() + n * 864e5).toISOString().slice(0, 10);
const finDeMois = periode => { const [a, m] = periode.split('-').map(Number); return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10); };
const ajouterMois = (d, n) => { const x = jour(d); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };

// Durées de validité (jours) : au-delà, la donnée est retirée de l'affichage.
export const VALIDITE = {
  tauxMoyenJours: 100,      // publication mensuelle environ 5 semaines après le mois ; marge d'un mois manqué
  bceJours: 21,             // réunions de politique monétaire toutes les 6 semaines environ
  actualiteAccueilJours: 60,
  actualitePageJours: 365,
};

// Date (AAAA-MM-JJ) jusqu'à laquelle chaque indicateur peut être affiché.
export function expirations(ind) {
  return {
    tauxMoyen: ind.tauxMoyen ? ajouterJours(finDeMois(ind.tauxMoyen.periode), VALIDITE.tauxMoyenJours) : null,
    usure: ind.usure ? ajouterJours(ajouterMois(ind.usure.applicableDepuis, 3), -1) : null,
    bce: ind.bce ? ajouterJours(ind.bce.observeLe, VALIDITE.bceJours) : null,
  };
}

// Indicateurs affichables à la date donnée (les autres valent null).
export function indicateursValides(ind, aujourdhui) {
  const exp = expirations(ind);
  const ok = (cle, debut) => ind[cle] && exp[cle] && aujourdhui <= exp[cle] && (!debut || debut <= aujourdhui) ? { ...ind[cle], expire: exp[cle] } : null;
  return {
    tauxMoyen: ok('tauxMoyen'),
    usure: ok('usure', ind.usure?.applicableDepuis),
    bce: ok('bce'),
  };
}

export function actualitesValides(actus, aujourdhui, jours) {
  const limite = ajouterJours(aujourdhui, -jours);
  return actus.filter(a => a.date >= limite && a.date <= aujourdhui).sort((a, b) => b.date.localeCompare(a.date) || a.titre.localeCompare(b.titre));
}

const normaliser = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Fusionne les nouvelles actualités avec l'historique : pas de doublon (même lien, même identifiant ou même titre),
// la première date de détection est conservée, les éléments de plus de 400 jours sont purgés.
export function fusionnerActualites(existantes, nouvelles, aujourdhui) {
  const resultat = [...existantes];
  const cles = new Set(existantes.flatMap(a => [a.id, a.lien, normaliser(a.titre)]));
  for (const n of nouvelles) {
    const id = n.guid || n.lien;
    if (cles.has(id) || cles.has(n.lien) || cles.has(normaliser(n.titre))) continue;
    resultat.push({ id, titre: n.titre, resume: n.resume, lien: n.lien, date: n.date, source: n.source, categorie: categorie(n), detecteLe: aujourdhui });
    cles.add(id); cles.add(n.lien); cles.add(normaliser(n.titre));
  }
  const limite = ajouterJours(aujourdhui, -400);
  return resultat.filter(a => a.date >= limite).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

// Périodes mensuelles à essayer pour la publication Banque de France, de la plus récente à la plus ancienne.
export function periodesCandidates(aujourdhui, nombre = 4) {
  const [a, m] = aujourdhui.split('-').map(Number);
  return Array.from({ length: nombre }, (_, i) => {
    const d = new Date(Date.UTC(a, m - 2 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

export const trimestre = aujourdhui => { const [a, m] = aujourdhui.split('-').map(Number); return { annee: a, t: Math.ceil(m / 3) }; };
