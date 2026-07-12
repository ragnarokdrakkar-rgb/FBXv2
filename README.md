# Fuzijska biopsija Desktop

Windows Electron aplikacija za evidenco, naročanje, lokalno hrambo dokumentov in pripravo DICOM/PDF prenosa za fuzijsko biopsijo.

## Verzija 1.3.0

- lokalna SQLite baza,
- podatki ločeni od namestitve programa,
- šifrirani Google Sheets backup prek Apps Script,
- lokalna hramba celotnih DICOM map in MR PDF-izvidov,
- množična izbira in naročanje pacientov,
- samodejna razporeditev na proste 40-minutne termine,
- pregled dokumentov za posamezen dan,
- preverjen prenos DICOM in PDF datotek na USB ali v izbrano mapo,
- CSV seznam, JSON manifest in lokalna zgodovina prenosov,
- Windows installer in GitHub Actions build.

## Lokalni razvoj

```bat
1-namesti.bat
2-zazeni.bat
```

## Windows installer

```bat
3-zgradi-exe.bat
```

Rezultat:

```text
release\Fuzijska-biopsija-Setup-1.3.0.exe
```

## Navodila

Google Apps Script:

```text
docs\FAZA-2-APPS-SCRIPT.md
```

DICOM in PDF:

```text
docs\FAZA-3-DICOM-PDF.md
```

Množično naročanje in USB prenos:

```text
docs\FAZA-4-MNOZICNO-USB.md
```

## Podatkovne lokacije

SQLite baza:

```text
%LOCALAPPDATA%\FuzijskaBiopsija\data\fuzijska-biopsija.sqlite
```

Privzeta mapa dokumentov:

```text
%USERPROFILE%\Documents\FuzijskaBiopsijaDokumenti
```

Glavno mapo dokumentov lahko spremeniš v nastavitvah aplikacije.

NSIS nastavitev `deleteAppDataOnUninstall: false` pomeni, da običajna odstranitev aplikacije lokalne baze ne izbriše. Dokumenti so prav tako zunaj namestitvene mape programa.
