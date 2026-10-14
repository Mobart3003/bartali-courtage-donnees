// Rendu HTML de la veille pour le générateur du site (outils/build.mjs).
// Seules les données encore valides à la date de génération sont affichées ;
// chaque bloc daté porte data-expire, que commun.js utilise pour le masquer
// si la page en ligne n'a pas été régénérée à temps (double sécurité).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { indicateursValides, actualitesValides, VALIDITE } from './regles.mjs';
import { libelleMois, dateValide, lienAutorise } from './analyseurs.mjs';

const echapper = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pct = v => `${v.toFixed(2).replace('.', ',')} %`;
const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const dateCourte = d => { const [a, m, j] = d.split('-').map(Number); return `${j} ${MOIS_COURTS[m - 1]} ${a}`; };
const dateLongue = d => { const [a, m, j] = d.split('-').map(Number); return `${j === 1 ? '1er' : j} ${libelleMois(`${a}-${String(m).padStart(2, '0')}`).split(' ')[0]} ${a}`; };
const plusJours = (d, n) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);

export const AVERTISSEMENT = 'Données nationales indicatives, sans valeur contractuelle. Le taux proposé dépend du profil et du projet.';

export function chargerVeille(racine, aujourdhui) {
  const lire = f => { const p = join(racine, 'src/data/veille', f); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; };
  const brut = lire('indicateurs.json') ?? {};
  // Double contrôle au rendu : une entrée invalide (date impossible, domaine non autorisé) n'est jamais affichée.
  const actualites = (lire('actualites.json') ?? []).filter(a => a && dateValide(a.date) && lienAutorise(a.lien) && a.titre);
  const dates = [actualites[0]?.detecteLe, ...['tauxMoyen', 'usure', 'bce'].map(k => brut[k]?.detecteLe)].filter(Boolean).sort();
  return {
    aujourdhui,
    maj: dates.at(-1) ?? null, // dernière modification réelle des données (sitemap)
    brut,
    ind: indicateursValides(brut, aujourdhui),
    accueil: actualitesValides(actualites, aujourdhui, VALIDITE.actualiteAccueilJours).slice(0, 3),
    annee: actualitesValides(actualites, aujourdhui, VALIDITE.actualitePageJours),
  };
}

function cartes(ind, detaille = false) {
  const c = [];
  if (ind.tauxMoyen) c.push(`<article class="carte repere" data-expire="${ind.tauxMoyen.expire}">
  <h3 class="repere-libelle">Taux moyen des nouveaux crédits à l'habitat</h3>
  <p class="repere-valeur">${pct(ind.tauxMoyen.valeur)}</p>
  <p class="repere-detail">${libelleMois(ind.tauxMoyen.periode)} · France, hors assurance et hors renégociations</p>
  <p class="repere-source">Source : <a href="${echapper(ind.tauxMoyen.sourceUrl)}" rel="noopener">Banque de France</a></p>
</article>`);
  if (ind.usure) c.push(`<article class="carte repere" data-expire="${ind.usure.expire}">
  <h3 class="repere-libelle">Taux d'usure, prêt à taux fixe de 20 ans et plus</h3>
  <p class="repere-valeur">${pct(ind.usure.vingtAnsEtPlus.usure)}</p>
  <p class="repere-detail">TAEG maximal légal, applicable depuis le ${dateLongue(ind.usure.applicableDepuis)}${detaille ? ` (10 à 20 ans : ${pct(ind.usure.dixAVingtAns.usure)})` : ''}</p>
  <p class="repere-source">Source : <a href="${echapper(ind.usure.sourceUrl)}" rel="noopener">Banque de France</a></p>
</article>`);
  if (ind.bce) c.push(`<article class="carte repere" data-expire="${ind.bce.expire}">
  <h3 class="repere-libelle">Taux de dépôt de la BCE</h3>
  <p class="repere-valeur">${pct(ind.bce.valeur)}</p>
  <p class="repere-detail">${ind.bce.depuis ? `Inchangé depuis le ${dateLongue(ind.bce.depuis)}` : `Relevé le ${dateLongue(ind.bce.observeLe)}`} · influence le coût de financement des banques</p>
  <p class="repere-source">Source : <a href="${echapper(ind.bce.sourceUrl)}" rel="noopener">Banque centrale européenne</a></p>
</article>`);
  return c;
}

function listeActualites(actus, attrs = '') {
  return `<ul class="actus"${attrs}>${actus.map(a => `
  <li data-expire="${plusJours(a.date, VALIDITE.actualitePageJours)}"><time datetime="${a.date}">${dateCourte(a.date)}</time> <a href="${echapper(a.lien)}" rel="noopener">${echapper(a.titre)}</a> <span class="actu-source">${echapper(a.source)} · ${echapper(a.categorie)}</span></li>`).join('')}
</ul>`;
}

// Bloc de la page d'accueil. Sans aucune donnée valide : renvoi intemporel vers les guides.
export function blocAccueil(v, nouveautes = []) {
  const c = cartes(v.ind);
  const actus = v.accueil.map(a => ({ ...a }));
  const neufs = nouveautes.slice(0, 2);
  if (!c.length && !actus.length) {
    return `<section class="section" aria-labelledby="t-reperes"><div class="conteneur">
  <h2 id="t-reperes">Préparer son financement, chiffres officiels à l'appui</h2>
  <p>Frais de notaire dans le 06, PTZ, capacité d'emprunt : <a href="/guides.html">consultez les guides</a>, chacun sourcé et daté.</p>
</div></section>`;
  }
  return `<section class="section reperes-section" aria-labelledby="t-reperes"><div class="conteneur">
  <span class="surtitre">Mis à jour automatiquement depuis les sources officielles</span>
  <h2 id="t-reperes">Les repères du crédit immobilier en ce moment</h2>
  ${c.length ? `<div class="grille grille-3 reperes" data-groupe-expire data-veille="indicateurs" data-veille-donnees="${v.maj ?? ''}">${c.join('\n')}</div>
  <p class="petit discret reperes-avertissement">${AVERTISSEMENT}</p>` : ''}
  <div class="grille grille-2 reperes-bas">
    ${actus.length ? `<div><h3 class="reperes-titre">Actualités officielles</h3>${listeActualites(actus, ` data-veille="actus-accueil" data-veille-donnees="${v.maj ?? ''}"`)}</div>` : ''}
    ${neufs.length ? `<div><h3 class="reperes-titre">Nouveautés du site</h3><ul class="actus">${neufs.map(n => `
      <li><time datetime="${n.publie}">${dateCourte(n.publie)}</time> <a href="/${n.sortie}">${echapper(n.lien)}</a></li>`).join('')}</ul></div>` : ''}
  </div>
  <p><a class="lien-fleche" href="/actualites-credit-immobilier.html">Tous les repères et les actualités du crédit immobilier</a></p>
</div></section>`;
}

// Paragraphe du guide prêt relais : taux moyen officiel des crédits relais s'il est valide, sinon renvoi vers la source.
export function paragrapheRelais(v) {
  const t = v.ind.tauxMoyen;
  if (t && t.relais) {
    return `<p data-expire="${t.expire}" data-veille="relais" data-veille-donnees="${v.maj ?? ''}">Repère officiel : le taux moyen des crédits relais nouveaux était de <strong>${pct(t.relais)} en ${libelleMois(t.periode)}</strong> (taux effectif au sens étroit, hors assurance et frais), contre ${pct(t.valeur)} pour l'ensemble des crédits à l'habitat hors renégociations (<a href="${echapper(t.sourceUrl)}" rel="noopener">Banque de France, crédits aux particuliers</a>). C'est une moyenne nationale, pas un taux proposé : le vôtre dépend de votre dossier et de la banque. Ce repère est mis à jour automatiquement chaque mois.</p>`;
  }
  return `<p data-veille="relais" data-veille-donnees="">Le taux moyen des crédits relais est publié chaque mois par la <a href="https://www.banque-france.fr/fr/statistiques/credit/credits-aux-particuliers" rel="noopener">Banque de France</a> (statistiques « Crédits aux particuliers »). C'est une moyenne nationale, pas un taux proposé : le vôtre dépend de votre dossier et de la banque.</p>`;
}

// Mini-graphique SVG de l'historique du taux moyen (sans script, accessible par le tableau qui suit).
function graphique(hist) {
  if (hist.length < 3) return '';
  const L = 560, H = 160, m = 28;
  const vals = hist.map(h => h.valeur), min = Math.min(...vals) - 0.1, max = Math.max(...vals) + 0.1;
  const x = i => m + (i * (L - 2 * m)) / (hist.length - 1), y = v => H - m - ((v - min) * (H - 2 * m)) / (max - min);
  const pts = hist.map((h, i) => `${x(i).toFixed(1)},${y(h.valeur).toFixed(1)}`).join(' ');
  return `<svg class="reperes-graphique" viewBox="0 0 ${L} ${H}" role="img" aria-label="Évolution du taux moyen des crédits à l'habitat, de ${libelleMois(hist[0].periode)} (${pct(hist[0].valeur)}) à ${libelleMois(hist.at(-1).periode)} (${pct(hist.at(-1).valeur)})">
  <polyline fill="none" stroke="currentColor" stroke-width="2.5" points="${pts}"/>
  ${hist.map((h, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(h.valeur).toFixed(1)}" r="3.5" fill="currentColor"/>`).join('')}
  <text x="${m}" y="${H - 6}" font-size="12" fill="currentColor">${libelleMois(hist[0].periode)}</text>
  <text x="${L - m}" y="${H - 6}" font-size="12" text-anchor="end" fill="currentColor">${libelleMois(hist.at(-1).periode)}</text>
</svg>`;
}

// Contenu de la page « Taux et actualités du crédit immobilier ».
export function pageActualites(v) {
  const c = cartes(v.ind, true);
  const t = v.ind.tauxMoyen;
  const hist = t ? (v.brut.tauxMoyen.historique ?? []) : [];
  const parMois = new Map();
  for (const a of v.annee) { const k = a.date.slice(0, 7); parMois.set(k, [...(parMois.get(k) ?? []), a]); }
  return `
<section class="section" aria-labelledby="t-chiffres"><div class="conteneur">
  <h2 id="t-chiffres">Les chiffres officiels du moment</h2>
  ${c.length ? `<div class="grille grille-3 reperes" data-groupe-expire data-veille="indicateurs-detail" data-veille-donnees="${v.maj ?? ''}">${c.join('\n')}</div>
  <p class="petit discret">${AVERTISSEMENT}</p>`
    : `<p>Les dernières publications officielles n'ont pas encore pu être vérifiées. Les chiffres réapparaîtront dès leur contrôle ; en attendant, consultez directement la <a href="https://www.banque-france.fr/fr/statistiques/credit" rel="noopener">Banque de France</a>.</p>`}
  ${t && hist.length >= 3 ? `<h3>Évolution du taux moyen des crédits à l'habitat</h3>
  ${graphique(hist)}
  <div class="defile-x"><table class="tableau"><caption class="sr-only">Taux moyen des crédits nouveaux à l'habitat hors renégociations, par mois</caption>
  <thead><tr><th scope="col">Mois</th><th scope="col">Taux moyen</th></tr></thead>
  <tbody>${[...hist].reverse().map(h => `<tr><td>${libelleMois(h.periode)}</td><td>${pct(h.valeur)}</td></tr>`).join('')}</tbody></table></div>` : ''}
</div></section>

<section class="section section-blanche" aria-labelledby="t-actus"><div class="conteneur">
  <h2 id="t-actus">Actualités officielles des 12 derniers mois</h2>
  ${parMois.size ? `<div data-veille="actus-page" data-veille-donnees="${v.maj ?? ''}">` + [...parMois].map(([mois, actus]) => `<h3 class="reperes-titre">${libelleMois(mois).replace(/^./, s => s.toUpperCase())}</h3>${listeActualites(actus)}`).join('\n') + '</div>'
    : `<p>Aucune actualité officielle récente sur le crédit et le logement n'a été retenue. Les guides du site restent à jour : <a href="/guides.html">voir les guides</a>.</p>`}
</div></section>`;
}
