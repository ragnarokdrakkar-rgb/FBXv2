# Tehnična zasnova

## Glavni deli

- `src/main/database.cjs` – lokalna SQLite baza, revizije in evidenca dokumentov,
- `src/main/document-manager.cjs` – varno kopiranje DICOM map in MR PDF-izvidov,
- `src/main/export-manager.cjs` – množični preverjen prenos na USB ali v mapo,
- `src/main/cloud-crypto.cjs` – stiskanje, AES-256-GCM in A/B zapis,
- `src/main/cloud-manager.cjs` – Apps Script protokol, HMAC podpisi, sinhronizacija in obnova,
- `src/main/main.cjs` – Electron glavni proces, dialogi in IPC,
- `src/preload/preload.cjs` – omejen most do rendererja,
- `src/renderer/index.html` – uporabniški vmesnik,
- `apps-script/Code.gs` – vezani Google Apps Script web endpoint.

## Lokalni podatki

SQLite baza:

```text
%LOCALAPPDATA%\FuzijskaBiopsija\data\fuzijska-biopsija.sqlite
```

Cloud konfiguracija in z Windows zaščitene skrivnosti:

```text
%LOCALAPPDATA%\FuzijskaBiopsija\cloud\cloud-config.json
```

Konfiguracija glavne mape dokumentov:

```text
%LOCALAPPDATA%\FuzijskaBiopsija\documents\documents-config.json
```

Privzeta mapa DICOM/PDF dokumentov:

```text
%USERPROFILE%\Documents\FuzijskaBiopsijaDokumenti
```

## SQLite shema 2 in 3

Poleg obstoječih tabel vsebuje tabela `patient_assets`:

- ID dokumenta,
- ID pacienta,
- vrsto `dicom` ali `mr_pdf`,
- oznako trenutne različice,
- lokalno pot,
- izvorno in prikazno ime,
- število datotek,
- skupno velikost,
- stanje preverjanja,
- tehnične metapodatke in čas vnosa.

Velike DICOM in PDF datoteke niso shranjene znotraj SQLite baze. Baza hrani samo preverjeno evidenco poti in metapodatkov.

## Kopiranje DICOM

1. rekurenčni pregled izvorne mape brez sledenja simbolnim povezavam,
2. izračun števila datotek in skupne velikosti,
3. preverjanje prostega prostora,
4. kopiranje v unikatno začasno mapo z največ štirimi sočasnimi kopiranji,
5. preverjanje obstoja in velikosti vsake kopirane datoteke,
6. preimenovanje začasne mape v končno,
7. zapis metapodatkov v SQLite.

Ob napaki se začasna kopija odstrani, veljavna prejšnja različica pa ostane nedotaknjena.

## Kopiranje PDF

Aplikacija preveri končnico `.pdf`, glavo `%PDF-`, velikost kopije in nato datoteko preimenuje v unikatno ime s pacientovim indeksom, imenom in datumom dodajanja.

## Cloud protokol

EXE pošlje Apps Scriptu:

- verzijo protokola,
- dejanje,
- trenutni čas,
- naključni nonce,
- JSON telo kot niz,
- HMAC-SHA256 podpis.

Podpis pokriva čas, nonce, dejanje in SHA-256 telesa. Apps Script preveri časovno okno, ponovitev nonce vrednosti in podpis.

## Šifriranje

- KDF: Node `scrypt`,
- šifra: AES-256-GCM,
- stiskanje: gzip,
- nov IV pri vsakem zapisu,
- SHA-256 celotnega odprtega posnetka za dodatno preverjanje,
- šifrirni ključ nikoli ne zapusti EXE aplikacije.

## Kaj je v cloud kopiji

Cloud posnetek vsebuje:

- paciente,
- termine in statuse,
- nastavitve aplikacije.

Ne vsebuje binarnih DICOM ali PDF datotek in ne kopira lokalne mape dokumentov.

## Google Sheet

- `Meta` – tehnični metapodatki, salt, aktivni slot in revizija,
- `Backup_A` – šifrirani bloki,
- `Backup_B` – šifrirani bloki,
- `Navodila` – generično pojasnilo brez pacientskih podatkov.

Apps Script uporablja `LockService`, da prepreči hkratno prepisovanje tehničnih zavihkov.

## SQLite shema 3

Tabela `export_runs` lokalno beleži:

- datum fuzij,
- ciljno mapo,
- število pacientov,
- število datotek in skupno velikost,
- manjkajoče dokumente,
- stanje `started`, `completed`, `cancelled` ali `failed`,
- čas začetka in zaključka.

## Množični izvoz

`src/main/export-manager.cjs`:

1. prebere naročene paciente za konkretni datum,
2. pridobi trenutni DICOM in PDF zapis iz SQLite,
3. ponovno pregleda dejansko DICOM strukturo na disku,
4. preveri ciljni prostor,
5. kopira v začasno mapo z največ štirimi sočasnimi kopiranji,
6. preveri velikost vsake ciljne datoteke,
7. ustvari CSV seznam in JSON manifest,
8. začasno mapo šele po uspehu preimenuje v končno,
9. zapiše rezultat v `export_runs`.

Ob preklicu ali napaki se nedokončana začasna mapa odstrani. Obstoječ cilj se nikoli ne prepiše; uporabi se novo zaporedno ime.

## Samodejne posodobitve (od sheme aplikacije 1.4.0)

- Windows paket ostaja NSIS.
- `electron-updater` bere `app-update.yml`, ki ga electron-builder vgradi med buildom.
- GitHub Release mora vsebovati installer, `latest.yml` in `.blockmap`.
- Prenos poteka samodejno, namestitev pa samo po uporabnikovi potrditvi.
- Pred `quitAndInstall()` se z `node:sqlite.backup()` ustvari samostojna SQLite kopija in preveri s `PRAGMA quick_check`.
- Varnostne kopije pred posodobitvami so ločene od namestitve programa.
- DICOM/PDF shramba ni del installerja in je updater ne spreminja.
