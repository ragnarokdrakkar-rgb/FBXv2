#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupRoot = path.join(path.dirname(root), `${path.basename(root)}-backup-v1.6.0-${stamp}`);

const files = {
  packageJson: path.join(root, 'package.json'),
  packageLock: path.join(root, 'package-lock.json'),
  index: path.join(root, 'src', 'renderer', 'index.html'),
  preload: path.join(root, 'src', 'preload', 'preload.cjs'),
  main: path.join(root, 'src', 'main', 'main.cjs'),
  database: path.join(root, 'src', 'main', 'database.cjs'),
  documents: path.join(root, 'src', 'main', 'document-manager.cjs'),
  changelog: path.join(root, 'CHANGELOG.md'),
  readme: path.join(root, 'README.md'),
};

function fail(message) {
  console.error(`\nNAPAKA: ${message}\n`);
  process.exit(1);
}

function read(file) {
  if (!fs.existsSync(file)) fail(`Manjka datoteka: ${path.relative(root, file)}`);
  return fs.readFileSync(file, 'utf8');
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content.replace(/\r?\n/g, '\n'), 'utf8');
}

function backup(file) {
  if (!fs.existsSync(file)) return;
  const relative = path.relative(root, file);
  const target = path.join(backupRoot, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(file, target);
}

function replaceOnce(text, search, replacement, label) {
  const index = text.indexOf(search);
  if (index < 0) fail(`V datoteki ni pričakovanega mesta za popravek: ${label}`);
  if (text.indexOf(search, index + search.length) >= 0) {
    fail(`Vzorec za popravek ni unikaten: ${label}`);
  }
  return text.slice(0, index) + replacement + text.slice(index + search.length);
}

function replaceRegex(text, regex, replacement, label) {
  const matches = text.match(new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`));
  if (!matches || matches.length !== 1) fail(`Pričakovan je en zadetek za: ${label}; najdeno: ${matches ? matches.length : 0}`);
  return text.replace(regex, replacement);
}

for (const file of Object.values(files)) {
  if (fs.existsSync(file)) backup(file);
}

const packageJson = JSON.parse(read(files.packageJson));
if (!['1.5.0', '1.6.0'].includes(packageJson.version)) {
  fail(`Ta patch je namenjen različici 1.5.0. Trenutna package.json različica je ${packageJson.version}.`);
}
if (packageJson.version === '1.6.0' && fs.existsSync(path.join(root, 'scripts', 'phase7-result-archive-test.cjs'))) {
  console.log('Različica 1.6.0 je že nameščena. Nobena datoteka ni bila spremenjena.');
  process.exit(0);
}
packageJson.version = '1.6.0';
packageJson.description = 'Lokalna Windows aplikacija za evidenco, DICOM/PDF dokumente, rezultate fuzijske biopsije, arhiviranje, množično naročanje, preverjen USB prenos in samodejne GitHub posodobitve.';
packageJson.scripts.test = packageJson.scripts.test.replace(
  'node scripts/phase6-test.cjs && node scripts/export-manager-test.cjs',
  'node scripts/phase6-test.cjs && node scripts/phase7-result-archive-test.cjs && node scripts/export-manager-test.cjs',
);
if (!packageJson.scripts.test.includes('phase7-result-archive-test.cjs')) {
  fail('V package.json ni bilo mogoče dodati testa faze 7.');
}
write(files.packageJson, `${JSON.stringify(packageJson, null, 2)}\n`);

const lock = JSON.parse(read(files.packageLock));
lock.version = '1.6.0';
if (lock.packages && lock.packages['']) lock.packages[''].version = '1.6.0';
write(files.packageLock, `${JSON.stringify(lock, null, 2)}\n`);

let preload = read(files.preload);
preload = replaceOnce(
  preload,
  "  documentsDeleteAsset: (assetId) => ipcRenderer.invoke('documents:delete-asset', assetId),",
  "  documentsDeleteAsset: (assetId) => ipcRenderer.invoke('documents:delete-asset', assetId),\n  documentsDeletePatient: (patientId) => ipcRenderer.invoke('documents:delete-patient', patientId),",
  'preload API za brisanje vseh dokumentov pacienta',
);
write(files.preload, preload);

let main = read(files.main);
main = replaceOnce(
  main,
  "  ipcMain.handle('documents:delete-asset', async (_event, assetId) => documentManager.deleteAsset(String(assetId || '')));",
  "  ipcMain.handle('documents:delete-asset', async (_event, assetId) => documentManager.deleteAsset(String(assetId || '')));\n  ipcMain.handle('documents:delete-patient', async (_event, patientId) => documentManager.deletePatientDocuments(String(patientId || '')));",
  'IPC za brisanje vseh dokumentov pacienta',
);
write(files.main, main);

let database = read(files.database);
database = replaceOnce(
  database,
  "  #insertAudit(action, details) {",
  `  recordPatientEvent(patientId, eventType, title, details = {}) {
    return this.#transaction(() => {
      this.#insertPatientEvent(patientId, eventType, title, details);
      this.#insertAudit('patient_event_recorded', {
        patientId: asText(patientId, 100),
        eventType: asText(eventType, 100),
      });
      return { recorded: true };
    });
  }

  #insertAudit(action, details) {`,
  'javni zapis dogodka pacienta',
);

database = replaceOnce(
  database,
  "      const oldAppointment = `${old.terminDatum || ''}|${old.terminUra || ''}`;",
  `      const oldResult = String(old.rezultatBiopsije || '');
      const newResult = String(patient.rezultatBiopsije || '');
      if (oldResult !== newResult) {
        const resultTitle = newResult === 'pozitivna'
          ? 'Rezultat biopsije: pozitiven'
          : newResult === 'negativna'
            ? 'Rezultat biopsije: negativen'
            : 'Rezultat biopsije odstranjen';
        this.#insertPatientEvent(id, 'biopsy_result', resultTitle, {
          from: oldResult,
          to: newResult,
          resultDate: patient.datumRezultataBiopsije || patient.datumZakljucka || '',
        }, timestamp);
      }

      if (!old.dokumentiIzbrisaniPoPozitivnem && patient.dokumentiIzbrisaniPoPozitivnem) {
        this.#insertPatientEvent(id, 'positive_documents_deleted', 'DICOM in MR izvid izbrisana po pozitivnem rezultatu', {
          deletedAt: patient.datumIzbrisaDokumentov || '',
          deletedCount: Number(patient.steviloIzbrisanihDokumentov || 0),
        }, timestamp);
      }

` + "      const oldAppointment = `${old.terminDatum || ''}|${old.terminUra || ''}`;",
  'beleženje rezultata biopsije',
);
write(files.database, database);

let documents = read(files.documents);
documents = replaceOnce(
  documents,
  "  resolveAsset(assetId) {",
  `  async deletePatientDocuments(patientId) {
    const patient = this.getPatient(patientId);
    const assets = this.getPatientAssets(patient.id);
    if (this.activePatients.has(patient.id)) {
      throw new Error('Za tega pacienta trenutno poteka drugo delo z dokumenti. Počakaj, da se konča.');
    }

    for (const asset of assets) {
      const storedPath = path.resolve(asset.storedPath);
      if (!this.isManagedPath(storedPath)) {
        throw new Error('Vsaj en dokument je izven znanih map shrambe. Zaradi varnosti avtomatsko brisanje ni dovoljeno.');
      }
    }

    this.beginPatientOperation(patient.id);
    const errors = [];
    let deletedCount = 0;
    let deletedBytes = 0;
    const cleanupFolders = new Set();

    const removeIfEmpty = async (folderPath) => {
      try {
        if (!this.isManagedPath(folderPath)) return;
        const entries = await fs.promises.readdir(folderPath);
        if (!entries.length) await fs.promises.rmdir(folderPath);
      } catch {}
    };

    try {
      for (const asset of assets) {
        const storedPath = path.resolve(asset.storedPath);
        try {
          await fs.promises.rm(storedPath, {
            recursive: asset.kind === 'dicom',
            force: true,
          });
          this.database.deletePatientAsset(asset.id);
          deletedCount += 1;
          deletedBytes += Number(asset.totalBytes || 0);

          if (asset.kind === 'mr_pdf') {
            cleanupFolders.add(path.dirname(storedPath));
            cleanupFolders.add(path.dirname(path.dirname(storedPath)));
          } else {
            cleanupFolders.add(path.dirname(storedPath));
          }
        } catch (error) {
          errors.push({
            assetId: asset.id,
            kind: asset.kind,
            storedPath,
            message: error.message || String(error),
          });
        }
      }

      const folders = Array.from(cleanupFolders).sort((a, b) => b.length - a.length);
      for (const folder of folders) await removeIfEmpty(folder);

      const complete = errors.length === 0;
      this.database.recordPatientEvent(
        patient.id,
        complete ? 'positive_documents_deleted' : 'positive_documents_delete_partial',
        complete
          ? 'Vsi DICOM in MR dokumenti izbrisani po pozitivnem rezultatu'
          : 'Brisanje dokumentov po pozitivnem rezultatu ni bilo popolno',
        { deletedCount, deletedBytes, errorCount: errors.length },
      );

      return {
        complete,
        patientId: patient.id,
        deletedCount,
        deletedBytes,
        errorCount: errors.length,
        errors,
        remainingAssets: this.getPatientAssets(patient.id),
        summary: this.getSummary()[patient.id] || {},
      };
    } finally {
      this.endPatientOperation(patient.id);
    }
  }

  resolveAsset(assetId) {`,
  'brisanje vseh dokumentov pacienta',
);
write(files.documents, documents);

let index = read(files.index);

index = replaceOnce(
  index,
  ".zn-odp{background:#EEF1F2;color:var(--siva)}",
  `.zn-odp{background:#EEF1F2;color:var(--siva)}
.zn-poz{background:var(--alarm-bg);color:var(--alarm)}
.zn-neg{background:var(--zeleno-bg);color:var(--zeleno)}
.rezultat-izbira{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}
.rezultat-karta{border:1px solid var(--crta);border-radius:12px;padding:14px;text-align:left;background:#fff;color:var(--tinta)}
.rezultat-karta b{display:block;font-size:16px;margin-bottom:5px}
.rezultat-karta span{display:block;font-size:12px;color:var(--siva);line-height:1.5}
.rezultat-karta.pozitiven{border-color:#E6B8B4}
.rezultat-karta.pozitiven b{color:var(--alarm)}
.rezultat-karta.negativen{border-color:#B9DCC7}
.rezultat-karta.negativen b{color:var(--zeleno)}
.rezultat-karta:disabled{opacity:.55;cursor:not-allowed}
@media(max-width:520px){.rezultat-izbira{grid-template-columns:1fr}}`,
  'CSS rezultata biopsije',
);

index = replaceOnce(
  index,
  "<!-- PIN zaklep -->",
  `<!-- rezultat fuzijske biopsije -->
<div class="zastor" id="zastorRezultat">
  <div class="okno" role="dialog" aria-modal="true" aria-labelledby="nasRezultat">
    <h2 id="nasRezultat">Opravil FB</h2>
    <div id="rezultatOseba" class="stanje"></div>
    <p class="namig" style="margin-top:0">Izberi rezultat biopsije. Pacient se v obeh primerih premakne v arhiv.</p>
    <div class="rezultat-izbira">
      <button type="button" class="rezultat-karta pozitiven" id="gumbRezultatPozitiven">
        <b>Pozitivna</b>
        <span>Pacient gre v arhiv. Vsi shranjeni DICOM in MR PDF dokumenti bodo po dodatni potrditvi trajno izbrisani.</span>
      </button>
      <button type="button" class="rezultat-karta negativen" id="gumbRezultatNegativen">
        <b>Negativna</b>
        <span>Pacient gre v arhiv. DICOM in MR izvid ostaneta shranjena za morebitno prihodnjo obravnavo.</span>
      </button>
    </div>
    <div class="akcije">
      <button class="gumb drugi" id="gumbRezultatPreklic">Prekliči</button>
    </div>
  </div>
</div>

<!-- PIN zaklep -->`,
  'modal rezultata biopsije',
);

index = replaceOnce(
  index,
  "  if(datumZakljucka) p.datumZakljucka = datumZakljucka;\n  return p;",
  `  if(datumZakljucka) p.datumZakljucka = datumZakljucka;
  const rezultatBiopsije = varnoBesedilo(raw.rezultatBiopsije, 20);
  if(['pozitivna','negativna'].includes(rezultatBiopsije)) p.rezultatBiopsije = rezultatBiopsije;
  const datumRezultataBiopsije = preveriDatum(raw.datumRezultataBiopsije, 'datum rezultata biopsije');
  if(datumRezultataBiopsije) p.datumRezultataBiopsije = datumRezultataBiopsije;
  if(raw.dokumentiIzbrisaniPoPozitivnem === true) p.dokumentiIzbrisaniPoPozitivnem = true;
  const datumIzbrisaDokumentov = preveriDatum(raw.datumIzbrisaDokumentov, 'datum izbrisa dokumentov');
  if(datumIzbrisaDokumentov) p.datumIzbrisaDokumentov = datumIzbrisaDokumentov;
  if(Number.isFinite(Number(raw.steviloIzbrisanihDokumentov))) {
    p.steviloIzbrisanihDokumentov = Math.max(0, Math.floor(Number(raw.steviloIzbrisanihDokumentov)));
  }
  return p;`,
  'ohranitev polj rezultata v normalizaciji',
);

index = replaceOnce(
  index,
  "let zdravjeDokumentiPoteka = false;",
  "let zdravjeDokumentiPoteka = false;\nlet rezultatPacientId = null;\nlet rezultatAkcijaPoteka = false;",
  'stanje modala rezultata',
);

index = index.replace(
  '>Označi opravljeno</button>',
  '>Opravil FB</button>',
);

index = replaceRegex(
  index,
  /function renderArhiv\(\)\{[\s\S]*?\n\}\n\nfunction renderKopije\(\)\{/,
  `function renderArhiv(){
  const q = $('#iskArh').value.trim();
  const f = $('#filArh').value;
  const sez = pacienti.filter(p => (p.status === 'opravljeno' || p.status === 'odpovedan') && ustreza(p, q) && ustrezaFilter(p, f))
    .sort((a, b) => (b.datumZakljucka || '').localeCompare(a.datumZakljucka || ''));
  $('#sezArh').innerHTML = sez.length ? sez.map(p => {
    const opr = p.status === 'opravljeno';
    const pozitiven = opr && p.rezultatBiopsije === 'pozitivna';
    const negativen = opr && p.rezultatBiopsije === 'negativna';
    const zn = !opr
      ? '<span class="znacka zn-odp">Odpovedano</span>'
      : pozitiven
        ? '<span class="znacka zn-poz">Pozitivna</span>'
        : negativen
          ? '<span class="znacka zn-neg">Negativna</span>'
          : '<span class="znacka zn-opr">Opravljeno</span>';
    const zakljucek = !opr
      ? 'Odpovedano'
      : pozitiven
        ? 'Pozitivna biopsija'
        : negativen
          ? 'Negativna biopsija'
          : 'Opravljeno';
    let dokumentInfo = dokumentStatus(p);
    if(pozitiven && p.dokumentiIzbrisaniPoPozitivnem){
      dokumentInfo = '<div class="stanje ok" style="margin:9px 0 0">DICOM in MR izvid sta bila po pozitivnem rezultatu trajno izbrisana.</div>';
    }else if(pozitiven){
      dokumentInfo = '<div class="stanje slabo" style="margin:9px 0 0">Pozitiven rezultat je shranjen, vendar popoln izbris dokumentov še ni potrjen.</div>' + dokumentStatus(p);
    }else if(negativen){
      dokumentInfo = dokumentStatus(p) + '<p class="namig" style="margin:7px 0 0">Dokumenti so ohranjeni zaradi morebitne prihodnje obravnave.</p>';
    }
    return '<article class="karton ' + (opr ? 'ok' : 'arhivsko') + '">' +
      '<div class="vrh"><div>' +
        '<div class="ime">' + esc(p.priimek) + ' ' + esc(p.ime) + zn + '</div>' +
        '<div class="meta">' + metaVrsta(p) + '</div>' +
        '<div class="rokvrsta">' + zakljucek + ' <b>' + fmtD(p.datumZakljucka) + '</b>' +
          (p.terminDatum ? ' · termin ' + fmtD(p.terminDatum) + (p.terminUra ? ' ob ' + esc(p.terminUra) : '') : '') + '</div>' +
      '</div></div>' +
      dokumentInfo +
      (p.opombe ? '<div class="opomba">' + esc(p.opombe) + '</div>' : '') +
      '<div class="akcije">' +
        dokumentGumb(p) +
        zgodovinaGumb(p) +
        (pozitiven && !p.dokumentiIzbrisaniPoPozitivnem ? '<button class="gumb nevaren mali" data-a="izbrisiPozitivneDokumente" data-id="' + esc(p.id) + '">Ponovi izbris dokumentov</button>' : '') +
        '<button class="gumb drugi mali" data-a="vrni" data-id="' + esc(p.id) + '">Vrni na čakalni seznam</button>' +
        '<button class="gumb nevaren mali" data-a="izbrisi" data-id="' + esc(p.id) + '">Izbriši trajno</button>' +
      '</div></article>';
  }).join('') : '<div class="prazno">' + (q || f ? 'Ni zadetkov za to iskanje.' : 'Arhiv je prazen.') + '</div>';
}

function renderKopije(){`,
  'nov prikaz arhiva z rezultatom biopsije',
);

index = replaceOnce(
  index,
  "/* ═══ 7 · Akcije na kartonih ═══ */",
  `function nastaviRezultatGumbe(zaseden){
  rezultatAkcijaPoteka = !!zaseden;
  ['#gumbRezultatPozitiven','#gumbRezultatNegativen','#gumbRezultatPreklic'].forEach(id => {
    const el = $(id); if(el) el.disabled = !!zaseden;
  });
}
function zapriRezultatBiopsije(){
  if(rezultatAkcijaPoteka) return;
  rezultatPacientId = null;
  $('#zastorRezultat').classList.remove('odprt');
}
function odpriRezultatBiopsije(id){
  const p = pacienti.find(x => x.id === id);
  if(!p) return;
  rezultatPacientId = id;
  $('#rezultatOseba').innerHTML = '<b>' + esc(p.priimek + ' ' + p.ime) + '</b> · MI ' + esc(p.maticniIndeks) +
    (p.terminDatum ? '<br>Termin: ' + fmtD(p.terminDatum) + (p.terminUra ? ' ob ' + esc(p.terminUra) : '') : '');
  $('#zastorRezultat').classList.add('odprt');
}
async function osveziPoIzbrisuDokumentov(){
  osveziDokumentPovzetek();
  renderVse();
  await osveziDokumentShrambo();
  if(document.querySelector('.zav.aktiven')?.dataset.tab === 'priprava') await osveziPripravo();
}
async function izbrisiDokumentePozitivnega(patientId, brezPonovnePotrditve=false){
  const p = pacienti.find(x => x.id === patientId);
  if(!p || p.rezultatBiopsije !== 'pozitivna') return false;
  if(!JE_NAMIZNA || !window.desktopApi.documentsDeletePatient){
    throw new Error('Avtomatsko brisanje dokumentov je na voljo samo v nameščeni namizni aplikaciji.');
  }
  if(!brezPonovnePotrditve && !confirm(
    'Trajno izbrišem vse DICOM mape in vse MR PDF-izvide za:\\n\\n' +
    p.priimek + ' ' + p.ime + ' (MI ' + p.maticniIndeks + ')?\\n\\nTega ni mogoče razveljaviti.'
  )) return false;

  try{
    const r = await window.desktopApi.documentsDeletePatient(patientId);
    if(!r || !r.complete){
      const napake = Array.isArray(r?.errors) ? r.errors.map(x => x.message).filter(Boolean).join('\\n') : '';
      throw new Error('Nekaterih dokumentov ni bilo mogoče izbrisati.' + (napake ? '\\n' + napake : ''));
    }
    const svezi = pacienti.find(x => x.id === patientId);
    if(!svezi) return false;
    svezi.dokumentiIzbrisaniPoPozitivnem = true;
    svezi.datumIzbrisaDokumentov = toISO(danes());
    svezi.steviloIzbrisanihDokumentov = Number(r.deletedCount || 0);
    if(!shrani('izbris dokumentov po pozitivnem rezultatu: ' + svezi.priimek)) {
      throw new Error('Dokumenti so izbrisani, oznake v bazi pa ni bilo mogoče shraniti.');
    }
    await osveziPoIzbrisuDokumentov();
    toast('Pozitiven rezultat je arhiviran; DICOM in MR izvid sta izbrisana.');
    return true;
  }catch(e){
    await osveziPoIzbrisuDokumentov().catch(() => {});
    throw e;
  }
}
async function potrdiRezultatBiopsije(rezultat){
  if(rezultatAkcijaPoteka || !['pozitivna','negativna'].includes(rezultat)) return;
  const p = pacienti.find(x => x.id === rezultatPacientId);
  if(!p) return;

  if(rezultat === 'pozitivna'){
    const d = dokumentiPovzetek[p.id] || {};
    const dokumenti = Number(!!d.hasDicom) + Number(!!d.hasPdf);
    const besedilo =
      'Potrdim POZITIVEN rezultat za:\\n\\n' + p.priimek + ' ' + p.ime +
      '\\n\\nPacient bo premaknjen v arhiv.' +
      (dokumenti
        ? '\\nVsi shranjeni DICOM in MR PDF dokumenti bodo nato trajno izbrisani.'
        : '\\nZa pacienta trenutno ni evidentiranih DICOM/PDF dokumentov.') +
      '\\n\\nNadaljujem?';
    if(!confirm(besedilo)) return;
  }

  nastaviRezultatGumbe(true);
  try{
    p.status = 'opravljeno';
    p.datumZakljucka = toISO(danes());
    p.rezultatBiopsije = rezultat;
    p.datumRezultataBiopsije = toISO(danes());
    delete p.dokumentiIzbrisaniPoPozitivnem;
    delete p.datumIzbrisaDokumentov;
    delete p.steviloIzbrisanihDokumentov;

    if(!shrani('rezultat FB ' + rezultat + ': ' + p.priimek)) return;
    $('#zastorRezultat').classList.remove('odprt');
    rezultatPacientId = null;

    if(rezultat === 'pozitivna'){
      try{
        await izbrisiDokumentePozitivnega(p.id, true);
      }catch(e){
        alert(
          'Pozitiven rezultat je shranjen in pacient je v arhivu, vendar brisanje dokumentov ni bilo popolnoma uspešno.\\n\\n' +
          (e.message || 'Neznana napaka.') +
          '\\n\\nV arhivu uporabi gumb »Ponovi izbris dokumentov«.'
        );
      }
    }else{
      toast('Negativen rezultat je arhiviran; DICOM in MR izvid ostaneta shranjena.');
    }
  }finally{
    nastaviRezultatGumbe(false);
  }
}

/* ═══ 7 · Akcije na kartonih ═══ */`,
  'funkcije rezultata in brisanja dokumentov',
);

index = replaceRegex(
  index,
  /    case 'opravljeno': \{[\s\S]*?      break;\n    \}/,
  `    case 'opravljeno': {
      if(p) odpriRezultatBiopsije(p.id);
      break;
    }`,
  'akcija Opravil FB',
);

index = replaceOnce(
  index,
  "    case 'odpovej': {",
  `    case 'izbrisiPozitivneDokumente': {
      if(p) izbrisiDokumentePozitivnega(p.id).catch(e => alert('Dokumentov ni bilo mogoče v celoti izbrisati.\\n\\n' + (e.message || 'Neznana napaka.')));
      break;
    }
    case 'odpovej': {`,
  'ponovitev izbrisa dokumentov',
);

index = replaceOnce(
  index,
  "      p.status = 'cakalni'; delete p.terminDatum; delete p.terminUra; delete p.datumZakljucka;",
  "      p.status = 'cakalni'; delete p.terminDatum; delete p.terminUra; delete p.datumZakljucka; delete p.rezultatBiopsije; delete p.datumRezultataBiopsije; delete p.dokumentiIzbrisaniPoPozitivnem; delete p.datumIzbrisaDokumentov; delete p.steviloIzbrisanihDokumentov;",
  'čiščenje rezultata ob vrnitvi na čakalni seznam',
);

index = replaceOnce(
  index,
  "  const g = ['Priimek','Ime','Datum rojstva','Matični indeks','Telefon','MR ustanova','Datum vpisa','Status','Termin','Ura','Zaključeno','Opombe'];",
  "  const g = ['Priimek','Ime','Datum rojstva','Matični indeks','Telefon','MR ustanova','Datum vpisa','Status','Termin','Ura','Zaključeno','Rezultat FB','Dokumenti izbrisani','Opombe'];",
  'CSV glava rezultata',
);
index = replaceOnce(
  index,
  "    fmtCSVDate(p.terminDatum), p.terminUra || '', fmtCSVDate(p.datumZakljucka), p.opombe || ''",
  "    fmtCSVDate(p.terminDatum), p.terminUra || '', fmtCSVDate(p.datumZakljucka), p.rezultatBiopsije === 'pozitivna' ? 'Pozitivna' : p.rezultatBiopsije === 'negativna' ? 'Negativna' : '', p.dokumentiIzbrisaniPoPozitivnem ? 'DA' : 'NE', p.opombe || ''",
  'CSV vrstica rezultata',
);

index = replaceOnce(
  index,
  "  if(event.eventType==='status_changed'&&d.to) return 'Nov status: '+(STAT[d.to]||d.to)+'.';",
  `  if(event.eventType==='status_changed'&&d.to) return 'Nov status: '+(STAT[d.to]||d.to)+'.';
  if(event.eventType==='biopsy_result') return d.to==='pozitivna'?'Pozitiven rezultat.':d.to==='negativna'?'Negativen rezultat.':'Rezultat odstranjen.';
  if(event.eventType==='positive_documents_deleted') return 'Izbrisanih dokumentov: '+Number(d.deletedCount||0)+'.';
  if(event.eventType==='positive_documents_delete_partial') return 'Izbrisanih: '+Number(d.deletedCount||0)+' · napak: '+Number(d.errorCount||0)+'.';`,
  'podrobnosti zgodovine rezultata',
);

index = replaceOnce(
  index,
  "  $('#gumbTerPreklic').addEventListener('click', zapriObrazce);",
  `  $('#gumbTerPreklic').addEventListener('click', zapriObrazce);
  $('#gumbRezultatPreklic').addEventListener('click', zapriRezultatBiopsije);
  $('#gumbRezultatPozitiven').addEventListener('click', () => potrdiRezultatBiopsije('pozitivna'));
  $('#gumbRezultatNegativen').addEventListener('click', () => potrdiRezultatBiopsije('negativna'));`,
  'dogodki modala rezultata',
);

index = index.replace(
  "aplikacija: 'Fuzijska biopsija', verzija: 6,",
  "aplikacija: 'Fuzijska biopsija', verzija: 7,",
);

write(files.index, index);

const testPath = path.join(root, 'scripts', 'phase7-result-archive-test.cjs');
write(testPath, `'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AppDatabase } = require('../src/main/database.cjs');
const { DocumentManager } = require('../src/main/document-manager.cjs');

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbx-phase7-'));
  const dbPath = path.join(temp, 'data', 'test.sqlite');
  const documentRoot = path.join(temp, 'documents');
  const configDirectory = path.join(temp, 'config');
  const db = new AppDatabase(dbPath);

  try {
    db.saveState({
      patients: [{
        id: 'patient-001',
        status: 'opravljeno',
        ime: 'Test',
        priimek: 'Pacient',
        maticniIndeks: 'TEST-001',
        datumVpisa: '2026-01-01',
        datumZakljucka: '2026-07-12',
        rezultatBiopsije: 'pozitivna',
        datumRezultataBiopsije: '2026-07-12',
        opombe: '',
      }],
      settings: {},
      description: 'phase7 test',
      expectedRevision: 0,
    });

    const patientFolder = path.join(documentRoot, 'Pacienti', 'TEST-001_Pacient_Test_patient-001');
    const dicomPath = path.join(patientFolder, 'DICOM_test');
    const pdfRoot = path.join(patientFolder, 'MR_izvidi');
    const pdfPath = path.join(pdfRoot, 'test.pdf');
    fs.mkdirSync(dicomPath, { recursive: true });
    fs.mkdirSync(pdfRoot, { recursive: true });
    fs.writeFileSync(path.join(dicomPath, 'image.dcm'), 'DICOM');
    fs.writeFileSync(pdfPath, '%PDF-test');

    db.addPatientAsset({
      id: 'asset-dicom',
      patientId: 'patient-001',
      kind: 'dicom',
      isCurrent: true,
      storedPath: dicomPath,
      sourceName: 'DICOM_test',
      displayName: 'DICOM test',
      fileCount: 1,
      totalBytes: 5,
      verified: true,
    });
    db.addPatientAsset({
      id: 'asset-pdf',
      patientId: 'patient-001',
      kind: 'mr_pdf',
      isCurrent: true,
      storedPath: pdfPath,
      sourceName: 'test.pdf',
      displayName: 'test.pdf',
      fileCount: 1,
      totalBytes: 9,
      verified: true,
    });

    const manager = new DocumentManager({
      database: db,
      configDirectory,
      defaultRoot: documentRoot,
      log: () => {},
      onProgress: () => {},
    });

    const result = await manager.deletePatientDocuments('patient-001');
    assert.equal(result.complete, true);
    assert.equal(result.deletedCount, 2);
    assert.equal(db.getPatientAssets('patient-001').length, 0);
    assert.equal(fs.existsSync(dicomPath), false);
    assert.equal(fs.existsSync(pdfPath), false);

    const history = db.getPatientHistory('patient-001', 50);
    assert.ok(history.some(item => item.eventType === 'positive_documents_deleted'));

    console.log('phase7-result-archive-test: OK');
  } finally {
    db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
`);

const docsPath = path.join(root, 'docs', 'FAZA-7-REZULTAT-IN-ARHIV.md');
write(docsPath, `# Faza 7 – rezultat fuzijske biopsije in arhiv

Različica: **1.6.0**

## Potek

Na seznamu naročenih je gumb **Opravil FB**.

### Pozitivna

- pacient se premakne v arhiv,
- rezultat se zapiše kot pozitiven,
- aplikacija zahteva dodatno potrditev,
- vsi evidentirani DICOM in MR PDF dokumenti se trajno izbrišejo,
- v zgodovino se zapišeta rezultat in brisanje,
- če brisanje ni popolno, je v arhivu prikazan gumb **Ponovi izbris dokumentov**.

### Negativna

- pacient se premakne v arhiv,
- rezultat se zapiše kot negativen,
- DICOM in MR PDF ostaneta shranjena,
- dokumenti so še vedno dostopni iz arhiva.

## Varnost

Najprej se rezultat in arhiviranje shranita v SQLite. Šele nato aplikacija briše dokumente. Če pride do napake pri brisanju, pacient ostane pravilno arhiviran, arhiv pa jasno pokaže, da je treba brisanje ponoviti.

## Test

\`\`\`bat
npm test
2-zazeni.bat
\`\`\`

Ročni test:

1. dodaj testnega pacienta,
2. dodaj testni DICOM in PDF,
3. naroči ga,
4. klikni **Opravil FB → Pozitivna**,
5. preveri arhiv in fizično mapo dokumentov,
6. ponovi z drugim pacientom in izberi **Negativna**,
7. preveri, da dokumenti drugega pacienta ostanejo.
`);

if (fs.existsSync(files.changelog)) {
  let changelog = read(files.changelog);
  if (!changelog.includes('## 1.6.0')) {
    changelog = replaceOnce(
      changelog,
      '# Changelog\n',
      `# Changelog

## 1.6.0

- gumb **Opravil FB** odpre izbiro pozitivnega ali negativnega rezultata,
- oba rezultata pacienta premakneta v arhiv,
- pozitiven rezultat po dodatni potrditvi trajno izbriše DICOM in MR PDF,
- negativen rezultat dokumente ohrani,
- arhiv jasno pokaže rezultat in stanje dokumentov,
- neuspešen ali delni izbris je mogoče ponoviti,
- rezultat in brisanje se zapišeta v zgodovino pacienta,
- CSV izvoz vsebuje rezultat FB in podatek o izbrisu dokumentov.

`,
      'CHANGELOG 1.6.0',
    );
    write(files.changelog, changelog);
  }
}

if (fs.existsSync(files.readme)) {
  let readme = read(files.readme);
  readme = readme.replace(/Fuzijska biopsija Desktop 1\.5\.0/g, 'Fuzijska biopsija Desktop 1.6.0');
  if (!readme.includes('## Rezultat biopsije in arhiv')) {
    readme += `

## Rezultat biopsije in arhiv

Gumb **Opravil FB** omogoča izbiro pozitivnega ali negativnega rezultata. Pozitiven rezultat izbriše DICOM/PDF po dodatni potrditvi, negativen pa dokumente ohrani.

Podrobnosti: \`docs/FAZA-7-REZULTAT-IN-ARHIV.md\`.
`;
  }
  write(files.readme, readme);
}

const instructionPath = path.join(root, 'PATCH-1.6.0-NAVODILA.txt');
write(instructionPath, `FBX UPDATE 1.6.0
================

1. npm test
2. 2-zazeni.bat
3. Rocno testiraj pozitiven in negativen rezultat.
4. git status
5. git add .
6. git commit -m "Verzija 1.6.0 - rezultat FB in arhiv dokumentov"
7. git push origin main
8. git tag v1.6.0
9. git push origin v1.6.0

V GitHub Releaseu preveri Setup.exe, blockmap in latest.yml.
`);

console.log('\nUPDATE 1.6.0 JE UPORABLJEN.');
console.log(`Varnostna kopija spremenjenih datotek: ${backupRoot}`);
console.log('\nNaslednji ukazi:');
console.log('  npm test');
console.log('  2-zazeni.bat');
console.log('\nNato ročno testiraj pozitiven in negativen rezultat.\n');
