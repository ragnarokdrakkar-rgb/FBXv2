# Faza 6 – priprava dneva, zdravje podatkov in zgodovina

Različica: **1.5.0**

## Kaj je novo

### Priprava dneva

Nov zavihek **Priprava dneva** za izbrani razpisani datum pokaže:

- število naročenih pacientov,
- število pacientov, ki imajo oba dokumenta,
- število manjkajočih DICOM/PDF dokumentov,
- število prostih mest,
- zadnji uspešen, preklican ali neuspešen prenos,
- pregled vsakega pacienta z gumboma **Dokumenti** in **Zgodovina**.

Iz istega pogleda lahko takoj odpreš obstoječi preverjeni prenos na USB ali v mapo.

### Zdravje SQLite baze

V **Nastavitve → Zdravje aplikacije in dokumentov** je gumb **Preveri SQLite bazo**.

Preverjanje izvede:

- `PRAGMA quick_check`,
- preverjanje tujih ključev,
- pregled različice podatkovne sheme,
- štetje pacientov, dogodkov, dokumentov in prenosov,
- pregled velikosti glavne SQLite, WAL in SHM datoteke.

### Celovito preverjanje dokumentov

Gumb **Preveri vse DICOM/PDF** ponovno pregleda vse trenutne dokumente:

- ali pot obstaja,
- ali je DICOM res mapa,
- ali DICOM mapa ni prazna,
- ali se število in skupna velikost datotek ujemata z zapisom ob uvozu,
- ali je MR izvid res PDF,
- ali se velikost PDF-ja ujema z zapisom.

Pri velikih DICOM mapah lahko preverjanje traja. Med preverjanjem je prikazan napredek.

### Zgodovina pacienta

Na kartonu pacienta je nov gumb **Zgodovina**. Od različice 1.5.0 naprej se beležijo:

- dodajanje pacienta,
- sprememba statusa,
- določitev, prestavitev ali odstranitev termina,
- sprememba osnovnih podatkov,
- dodajanje in brisanje DICOM/PDF,
- uspešen prenos dokumentov za dan fuzij.

Za paciente, ki so obstajali pred različico 1.5.0, se zgodovina začne z nadgradnjo. Starih dogodkov, ki prej niso bili beleženi, ni mogoče zanesljivo rekonstruirati.

### Diagnostika brez osebnih podatkov

Gumb **Izvozi diagnostiko brez osebnih podatkov** ustvari JSON z:

- različico aplikacije,
- stanjem SQLite baze,
- tehničnimi števci dokumentov,
- stanjem cloud povezave,
- stanjem posodobitev.

Poročilo ne vsebuje imen, matičnih indeksov, datumov rojstva, telefonov ali opomb.

## Nadgradnja domačega računalnika

Če imaš trenutno nameščeno 1.4.3, objavi 1.5.0 v GitHub Releases. Nameščena aplikacija mora sama ponuditi posodobitev.

V projektni mapi:

```bat
npm test
git add .
git commit -m "Faza 6 - priprava dneva in preverjanje zdravja"
git push origin main
git tag v1.5.0
git push origin v1.5.0
```

Po koncu GitHub Actions mora Release vsebovati:

```text
Fuzijska-biopsija-Setup-1.5.0.exe
Fuzijska-biopsija-Setup-1.5.0.exe.blockmap
latest.yml
```

## Prenos na službeni računalnik

### Priporočena pot

1. Na domačem računalniku uporabljaj samo testne podatke. Pravih pacientskih podatkov ne vnašaj na osebni računalnik.
2. Na službenem računalniku prenesi `Fuzijska-biopsija-Setup-1.5.0.exe` iz GitHub Releasea ali ga prenesi z dovoljenim USB-medijem.
3. Namesti aplikacijo pod svojim službenim Windows uporabnikom.
4. Ob prvem zagonu v **Nastavitve → DICOM in MR izvidi** izberi službeno mapo dokumentov, na primer:

```text
D:\FuzijskaBiopsijaDokumenti
```

5. V **Šifrirana Google Sheets kopija prek Apps Script** ponovno vnesi:
   - `/exec` URL,
   - 64-mestni dostopni ključ.
6. Klikni **Shrani in preveri povezavo**.
7. Klikni **Priklopi obstoječi backup**, vnesi obnovitveno geslo in nato **Obnovi lokalno bazo iz clouda**.
8. Preveri število pacientov, termine in nastavitve.
9. Zaženi **Preveri SQLite bazo**.
10. DICOM in PDF se iz clouda ne obnovijo. Na službenem računalniku jih ponovno dodaj iz originalnih virov.

### Česa ne kopiraj neposredno

Ne kopiraj celotne mape `%LOCALAPPDATA%\FuzijskaBiopsija` z domačega na službeni računalnik. Google dostopni ključ in lokalni šifrirni ključ sta zaščitena z Windows `safeStorage` in sta vezana na Windows okolje. Na službenem računalniku cloud povezavo nastavi znova.

### Če službeni računalnik nima dostopa do GitHuba

Installer lahko preneseš doma in ga preneseš na službeni računalnik po postopku, ki ga dovoljuje ustanova. Samodejne prihodnje posodobitve ne bodo delovale, dokler službeno omrežje ne omogoča dostopa do javnega GitHub Releasea.

### Organizacijske omejitve

Installer trenutno ni podpisan s komercialnim certifikatom, zato lahko Windows SmartScreen ali službena zaščita zahteva odobritev informatike. Ne obidi službenih varnostnih pravil; installer in uporabo Apps Scripta naj po potrebi odobri IT oziroma odgovorna oseba za varstvo podatkov.

## Kontrolni test na službenem računalniku

Pred pravo uporabo izvedi test z izmišljenim pacientom:

1. dodaj testnega pacienta,
2. razpiši dan fuzij,
3. naroči pacienta,
4. dodaj testno DICOM mapo in testni PDF,
5. odpri **Priprava dneva**,
6. preveri, da je pacient označen kot pripravljen,
7. izvedi testni prenos v prazno mapo,
8. preveri zgodovino pacienta,
9. preveri SQLite bazo in vse dokumente,
10. izbriši testnega pacienta in testne datoteke.
