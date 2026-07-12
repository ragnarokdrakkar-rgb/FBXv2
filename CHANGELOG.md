# Changelog

## 1.3.0

- potrditvena polja za izbiro več pacientov na čakalnem seznamu,
- gumb za izbiro vseh trenutno prikazanih pacientov,
- množično naročanje na konkreten razpisani dan,
- ročna sprememba vrstnega reda pred dodelitvijo terminov,
- avtomatska dodelitev prostih 40-minutnih terminov,
- pregled pripravljenosti DICOM in PDF dokumentov po dnevu,
- množični prenos vseh dosegljivih dokumentov na USB ali v izbrano mapo,
- preverjanje prostega prostora, števila in velikosti kopiranih datotek,
- ohranitev originalne DICOM strukture in `DICOMDIR`,
- samodejno poimenovanje pacientovih map in PDF-izvidov,
- `seznam_pacientov.csv` in `manifest.json` v izvozni mapi,
- možnost preklica z odstranitvijo nedokončane začasne mape,
- lokalna zgodovina uspešnih, preklicanih in neuspešnih prenosov,
- SQLite migracija na podatkovno shemo 3.

## 1.2.0

- lokalna shramba celotnih DICOM map ob pacientu,
- ohranitev originalnih imen datotek, podmap in obstoječega `DICOMDIR`,
- preverjanje prostega prostora pred kopiranjem,
- prikaz napredka kopiranja in preverjanja,
- preverjanje števila in velikosti vseh kopiranih datotek,
- hramba MR izvida v PDF obliki z avtomatskim poimenovanjem,
- trenutna in zgodovinske različice DICOM/PDF dokumentov,
- ločena nastavljiva glavna mapa dokumentov,
- status DICOM in MR izvida na kartonu pacienta,
- SQLite migracija na podatkovno shemo 2.

## 1.1.0

- šifrirani Google Sheets backup prek vezanega Google Apps Scripta,
- brez Google Cloud Console, Sheets API-ja in OAuth JSON-a,
- podpis vsake zahteve s HMAC-SHA256,
- zaščita pred ponovitvijo stare zahteve s časom in nonce vrednostjo,
- lokalno AES-256-GCM šifriranje in stiskanje celotnega seznama,
- izmenični `Backup_A` / `Backup_B` zapis,
- ponovno branje in dešifriranje po vsakem zapisu,
- samodejna sinhronizacija ob spremembi lokalne SQLite baze,
- obnova na novem računalniku z obnovitvenim geslom,
- dostopni ključ in lokalni šifrirni ključ sta zaščitena z Windows `safeStorage`.

## 1.0.0

- Electron EXE aplikacija,
- lokalna SQLite baza,
- Windows NSIS installer,
- GitHub Actions build.

## 1.4.0 build popravek

- Windows gradnja uporablja uradni programski API `electron-builder` namesto neposrednega zagona `.cmd` datoteke.
- Odpravljen `spawnSync ... EINVAL` na novejših različicah Node.js.
