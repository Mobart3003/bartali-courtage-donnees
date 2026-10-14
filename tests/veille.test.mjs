// Tests du moteur de veille : analyse des sources réelles (instantanés du 13/10/2026),
// règles de fraîcheur, pertinence et dédoublonnage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyserCreditsParticuliers, analyserTauxUsure, analyserTauxBce, analyserRss, analyserListeServicePublic, ErreurSource } from '../outils/veille/analyseurs.mjs';
import { estPertinente, indicateursValides, actualitesValides, fusionnerActualites, periodesCandidates, expirations } from '../outils/veille/regles.mjs';

const fx = f => readFileSync(new URL(`./fixtures/veille/${f}`, import.meta.url), 'utf8');

test('Banque de France : taux moyen hors renégociations d\'août 2026 = 3,32 %', () => {
  const r = analyserCreditsParticuliers(fx('bdf-credits-2026-08.html'), '2026-08');
  assert.equal(r.valeur, 3.32);
  assert.equal(r.periode, '2026-08');
  assert.deepEqual(r.historique.map(h => h.periode), ['2025-08', '2026-06', '2026-07', '2026-08']);
  assert.deepEqual(r.historique.map(h => h.valeur), [3.10, 3.27, 3.30, 3.32]);
});

test('Banque de France : refuse une page dont la période ne correspond pas', () => {
  assert.throws(() => analyserCreditsParticuliers(fx('bdf-credits-2026-08.html'), '2026-09'), ErreurSource);
});

test('Banque de France : refuse une valeur du tableau non confirmée par la synthèse', () => {
  const html = fx('bdf-credits-2026-08.html').replace('atteindre 3,32 %', 'atteindre 3,40 %');
  assert.throws(() => analyserCreditsParticuliers(html, '2026-08'), /synthèse/);
});

test('Banque de France : page sans tableau → erreur, jamais de valeur inventée', () => {
  assert.throws(() => analyserCreditsParticuliers('<html><body>Maintenance</body></html>'), ErreurSource);
});

test("taux d'usure du 4e trimestre 2026 : 5,40 % (20 ans et plus), cohérent avec le TEM × 4/3", () => {
  const r = analyserTauxUsure(fx('bdf-usure-2026-q4.html'));
  assert.equal(r.applicableDepuis, '2026-10-01');
  assert.deepEqual(r.vingtAnsEtPlus, { tem: 4.05, usure: 5.40 });
  assert.deepEqual(r.dixAVingtAns, { tem: 3.51, usure: 4.68 });
});

test("taux d'usure : une valeur incohérente avec le TEM est rejetée", () => {
  const brut = fx('bdf-usure-2026-q4.html');
  const i = brut.indexOf('4,05', brut.indexOf('20 ans et plus', brut.indexOf('IMMOBILIERS')));
  const html = brut.slice(0, i) + '3,05' + brut.slice(i + 4);
  assert.throws(() => analyserTauxUsure(html), /incohérence/);
});

test('BCE : taux de dépôt et date du dernier changement', () => {
  const r = analyserTauxBce(fx('bce-dfr.csv'));
  assert.equal(r.valeur, 2.5);
  assert.equal(r.observeLe, '2026-10-13');
  assert.match(r.depuis, /^\d{4}-\d{2}-\d{2}$/);
});

test('BCE : date de changement inconnue si la fenêtre ne contient pas de changement', () => {
  const r = analyserTauxBce('TIME_PERIOD,OBS_VALUE\n2026-10-01,2.5\n2026-10-02,2.5\n');
  assert.equal(r.depuis, null);
});

test('RSS : éléments lus, paramètre de suivi retiré des liens, dates ISO', () => {
  const items = analyserRss(fx('service-public.rss'));
  assert.ok(items.length >= 5);
  for (const i of items) {
    assert.match(i.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.doesNotMatch(i.lien, /xtor=/);
    assert.ok(i.titre.length > 5);
  }
  assert.ok(analyserRss(fx('economie.rss')).length >= 5);
});

test('pertinence : sujets immobiliers retenus, sujets hors cible écartés', () => {
  assert.ok(estPertinente({ titre: 'PTZ 2027 : ce qui change pour les primo-accédants' }));
  assert.ok(estPertinente({ titre: 'Frais de notaire : hausse des droits de mutation dans certains départements' }));
  assert.ok(estPertinente({ titre: 'Location : encadrement des loyers prolongé', resume: 'Les loyers des logements…' }));
  assert.ok(!estPertinente({ titre: 'Le prix repère de vente de gaz va augmenter de 6,6 % en novembre', resume: 'logement' }));
  assert.ok(!estPertinente({ titre: 'Le téléphone au volant peut entraîner une suspension du permis' }));
});

test('fraîcheur : taux moyen affiché jusqu’à 100 jours après la fin du mois, puis retiré', () => {
  const ind = { tauxMoyen: { valeur: 3.32, periode: '2026-08' } };
  assert.equal(expirations(ind).tauxMoyen, '2026-12-09');
  assert.ok(indicateursValides(ind, '2026-12-09').tauxMoyen);
  assert.equal(indicateursValides(ind, '2026-12-10').tauxMoyen, null);
});

test("fraîcheur : le taux d'usure n'est affiché que pendant son trimestre d'application", () => {
  const ind = { usure: { applicableDepuis: '2026-10-01', vingtAnsEtPlus: { tem: 4.05, usure: 5.4 } } };
  assert.equal(indicateursValides(ind, '2026-09-30').usure, null);
  assert.ok(indicateursValides(ind, '2026-12-31').usure);
  assert.equal(indicateursValides(ind, '2027-01-01').usure, null);
});

test('fraîcheur : le taux BCE disparaît 21 jours après la dernière observation', () => {
  const ind = { bce: { valeur: 2.5, observeLe: '2026-10-13' } };
  assert.ok(indicateursValides(ind, '2026-11-03').bce);
  assert.equal(indicateursValides(ind, '2026-11-04').bce, null);
});

test('actualités : fenêtre de date, ordre antéchronologique, futur exclu', () => {
  const a = [{ titre: 'a', date: '2026-10-10' }, { titre: 'b', date: '2026-07-01' }, { titre: 'c', date: '2026-10-20' }];
  assert.deepEqual(actualitesValides(a, '2026-10-13', 60).map(x => x.titre), ['a']);
});

test('actualités : aucun doublon (identifiant, lien ou titre), purge après 400 jours', () => {
  const existantes = [{ id: 'A1', lien: 'https://x.fr/1', titre: 'PTZ : nouveautés', date: '2026-10-01' }, { id: 'V', lien: 'https://x.fr/v', titre: 'Vieux', date: '2025-01-01' }];
  const nouvelles = [
    { guid: 'A1', lien: 'https://x.fr/1', titre: 'PTZ : nouveautés', date: '2026-10-01' },
    { guid: 'A2', lien: 'https://x.fr/2', titre: 'PTZ : Nouveautés !', date: '2026-10-02' },
    { guid: 'A3', lien: 'https://x.fr/3', titre: 'Frais de notaire', date: '2026-10-05', source: 'S' },
  ];
  const r = fusionnerActualites(existantes, nouvelles, '2026-10-13');
  assert.deepEqual(r.map(x => x.id), ['A3', 'A1']);
  assert.equal(r[0].detecteLe, '2026-10-13');
});

test('périodes candidates : du mois précédent vers le passé', () => {
  assert.deepEqual(periodesCandidates('2026-01-15', 3), ['2025-12', '2025-11', '2025-10']);
});

test('RSS : la date de publication reste celle de Paris (pas de décalage UTC)', () => {
  const xml = '<rss><channel><item><title>PTZ</title><link>https://www.service-public.gouv.fr/x</link><dc:date>2026-10-12T00:00:00+02:00</dc:date></item><item><title>Notaire</title><link>https://www.economie.gouv.fr/y</link><pubDate>Mon, 12 Oct 2026 23:30:00 GMT</pubDate></item></channel></rss>';
  assert.deepEqual(analyserRss(xml).map(i => i.date), ['2026-10-12', '2026-10-13']);
});

test('Service-Public : la page des actualités donne titre, date, thème et identifiant', () => {
  const items = analyserListeServicePublic(fx('service-public-liste.html'));
  assert.ok(items.length >= 15);
  const usure = items.find(i => /taux d’usure/.test(i.titre));
  assert.ok(usure, 'actualité sur le taux d’usure présente');
  assert.equal(usure.date, '2026-09-30');
  assert.equal(usure.resume, 'Thème : Prêts bancaires');
  assert.ok(estPertinente(usure));
  assert.equal(new Set(items.map(i => i.guid)).size, items.length);
});

test('sécurité : page Service-Public sans marqueur de thème → échec rapide, pas de blocage (ReDoS)', () => {
  const carte = '<a href="https://www.service-public.gouv.fr/particuliers/actualites/A12345">Titre</a><p>Publié le 12 octobre 2026</p>';
  const debut = Date.now();
  assert.throws(() => analyserListeServicePublic(carte.repeat(3000)), ErreurSource);
  assert.ok(Date.now() - debut < 2000, `analyse trop lente : ${Date.now() - debut} ms`);
});

test('sécurité : balises non fermées → texte extrait sans blocage', async () => {
  const { texteBrut } = await import('../outils/veille/analyseurs.mjs');
  const debut = Date.now();
  texteBrut('<script>'.repeat(20000) + '<'.repeat(50000));
  assert.ok(Date.now() - debut < 2000);
});

test('sécurité : date impossible ou lien hors des sites officiels → actualité écartée', () => {
  const xml = '<rss><channel>'
    + '<item><title>PTZ A</title><link>https://www.service-public.gouv.fr/a</link><dc:date>2026-00-10</dc:date></item>'
    + '<item><title>PTZ B</title><link>https://exemple-malveillant.fr/b</link><dc:date>2026-10-10</dc:date></item>'
    + '<item><title>PTZ C</title><link>http://www.service-public.gouv.fr/c</link><dc:date>2026-10-10</dc:date></item>'
    + '<item><title>PTZ D</title><link>https://www.service-public.gouv.fr/d?xtor=RSS-1&amp;x=2</link><dc:date>2026-10-10</dc:date></item>'
    + '</channel></rss>';
  const r = analyserRss(xml);
  assert.deepEqual(r.map(i => i.titre), ['PTZ D']);
  assert.equal(r[0].lien, 'https://www.service-public.gouv.fr/d?x=2');
});

test('sécurité : une valeur BCE vide n\'est jamais lue comme 0 %', () => {
  const r = analyserTauxBce('TIME_PERIOD,OBS_VALUE\n2026-09-01,2.25\n2026-09-16,2.5\n2026-10-13,\n');
  assert.equal(r.valeur, 2.5);
  assert.equal(r.observeLe, '2026-09-16');
});

test('Banque de France : taux moyen des crédits relais lu dans le même tableau (3,79 % en août 2026)', () => {
  assert.equal(analyserCreditsParticuliers(fx('bdf-credits-2026-08.html'), '2026-08').relais, 3.79);
});
