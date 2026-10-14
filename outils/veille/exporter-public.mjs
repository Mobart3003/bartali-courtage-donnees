// Export public des données de veille : un seul fichier JSON, servi en HTTPS par GitHub Pages
// (dépôt public « bartali-courtage-donnees », données officielles uniquement, aucun secret).
// Le site le lit au chargement (assets/js/veille-direct.js) pour afficher des repères à jour
// sans aucune publication FTP. Chaque élément porte sa date d'expiration : le navigateur la revérifie.
// Usage : node outils/veille/exporter-public.mjs [dossier de sortie, défaut public/]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chargerVeille } from './rendu.mjs';
import { libelleMois } from './analyseurs.mjs';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function construireExport(v) {
  const ind = {};
  const t = v.ind.tauxMoyen;
  if (t) ind.tauxMoyen = { valeur: t.valeur, relais: t.relais ?? null, periode: t.periode, periodeLibelle: libelleMois(t.periode), sourceUrl: t.sourceUrl, expire: t.expire };
  const u = v.ind.usure;
  if (u) ind.usure = { vingtAnsEtPlus: u.vingtAnsEtPlus.usure, dixAVingtAns: u.dixAVingtAns.usure, applicableDepuis: u.applicableDepuis, sourceUrl: u.sourceUrl, expire: u.expire };
  const b = v.ind.bce;
  if (b) ind.bce = { valeur: b.valeur, depuis: b.depuis, observeLe: b.observeLe, sourceUrl: b.sourceUrl, expire: b.expire };
  return {
    version: 1,
    genereLe: new Date().toISOString(),
    donneesDu: v.maj,
    avertissement: 'Données nationales indicatives, sans valeur contractuelle. Le taux proposé dépend du profil et du projet.',
    indicateurs: ind,
    actualites: v.annee.map(a => ({ date: a.date, titre: a.titre, lien: a.lien, source: a.source, categorie: a.categorie })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sortie = process.argv[2] ?? join(RACINE, 'public');
  const donnees = construireExport(chargerVeille(RACINE, new Date().toISOString().slice(0, 10)));
  mkdirSync(sortie, { recursive: true });
  writeFileSync(join(sortie, 'veille.json'), JSON.stringify(donnees, null, 1) + '\n');
  console.log(`Export public : ${Object.keys(donnees.indicateurs).length} indicateur(s), ${donnees.actualites.length} actualité(s) → ${join(sortie, 'veille.json')}`);
}
