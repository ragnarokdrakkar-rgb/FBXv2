# Fuzijska biopsija Desktop 1.5.0

Lokalna Windows aplikacija za čakalni seznam, razpisane dneve fuzij, DICOM/PDF dokumente, množično naročanje, preverjen USB-prenos, šifrirano Google Sheets kopijo in GitHub samodejne posodobitve.

## Faza 6

- nov zavihek **Priprava dneva**,
- celovit pregled DICOM/PDF za naročene paciente,
- preverjanje zdravja SQLite baze,
- celovito preverjanje vseh trenutnih dokumentov,
- zgodovina pacienta,
- diagnostika brez osebnih podatkov,
- migracija podatkovne sheme 3 → 4.

## Lokalni podatki

Glavna baza:

```text
%LOCALAPPDATA%\FuzijskaBiopsija\data\fuzijska-biopsija.sqlite
```

DICOM in PDF se hranijo v uporabniško izbrani mapi. Običajna posodobitev ali odstranitev programa lokalne SQLite baze ne izbriše.

## Razvojni zagon

```text
1-namesti.bat
2-zazeni.bat
```

## Lokalni Windows build

```text
3-zgradi-exe.bat
```

Installer nastane v mapi `release`.

## GitHub Release

Repozitorij za updater je nastavljen na:

```text
ragnarokdrakkar-rgb/FBXv2
```

Za izdajo:

```bat
git add .
git commit -m "Fuzijska biopsija 1.5.0"
git push origin main
git tag v1.5.0
git push origin v1.5.0
```

Podrobnosti in postopek prenosa na službeni računalnik:

```text
docs\FAZA-6-STABILNOST-IN-PRENOS.md
```
