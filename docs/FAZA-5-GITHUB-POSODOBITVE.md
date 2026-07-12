# Faza 5 – samodejne posodobitve prek GitHub Releases

## Kaj ta verzija naredi

Verzija 1.4.0 doda samodejno preverjanje novih različic aplikacije v javnem GitHub repozitoriju.

Potek:

1. nameščeni EXE ob zagonu preveri zadnji objavljeni GitHub Release,
2. novo različico prenese v ozadju,
3. v aplikaciji se pokaže gumb **Posodobi na ...**,
4. namestitev se izvede šele po tvoji potrditvi,
5. pred ponovnim zagonom se ustvari preverjena kopija SQLite baze,
6. DICOM in PDF dokumenti se ne spreminjajo.

Varnostne kopije pred posodobitvami so v:

```text
%LOCALAPPDATA%\FuzijskaBiopsija\updates\database-backups
```

Hrani se zadnjih 10 kopij.

## Pomembna omejitev prve nadgradnje

Verzija 1.3.0 še nima updaterja, zato se na 1.4.0 ne more posodobiti sama.

**Verzijo 1.4.0 moraš enkrat namestiti ročno.** Od različice 1.4.0 naprej lahko prihodnje različice 1.4.1, 1.5.0 in novejše pridejo samodejno.

## 1. GitHub repozitorij mora biti javen

Za updater brez vgrajenega skrivnega tokena mora biti repozitorij z Releases javen.

V repozitoriju ni pacientskih podatkov. V njem so samo:

- izvorna koda aplikacije,
- GitHub Actions workflow,
- installerji in update metapodatki.

Pacienti, SQLite baza, DICOM in PDF ostanejo lokalno oziroma v tvojem šifriranem Google Sheets backupu.

Zasebnega GitHub tokena se ne sme vgraditi v EXE, ker bi ga bilo mogoče izvleči.

## 2. Namesti odvisnosti

Razširi ZIP v novo mapo in zaženi:

```text
1-namesti.bat
```

Skript namesti tudi produkcijski paket `electron-updater`.

Nato za test zaženi:

```text
2-zazeni.bat
```

Pri razvojnem zagonu bo v nastavitvah pisalo, da updater deluje samo v nameščenem EXE. To je pravilno.

## 3. Nastavi GitHub repozitorij za lokalni build

Zaženi:

```text
4-nastavi-github-update.bat
```

Vnesi repozitorij v obliki:

```text
UPORABNIK/REPO
```

Primer:

```text
ragnarokdrakkar-rgb/fuzijska-biopsija-desktop
```

Podatek se shrani v:

```text
build\update-repository.json
```

Če je projekt že Git repozitorij s pravilnim `origin` URL-jem, ga build skript zna zaznati tudi sam. V GitHub Actions se repozitorij samodejno prebere iz `GITHUB_REPOSITORY`.

## 4. Zgradi prvi installer z updaterjem

Zaženi:

```text
3-zgradi-exe.bat
```

V mapi `release` morajo nastati najmanj:

```text
Fuzijska-biopsija-Setup-1.4.0.exe
Fuzijska-biopsija-Setup-1.4.0.exe.blockmap
latest.yml
```

Za samodejne posodobitve niso dovolj samo `.exe` datoteke. `latest.yml` in `.blockmap` morata biti prav tako objavljena v GitHub Release.

Namesti `Fuzijska-biopsija-Setup-1.4.0.exe` čez trenutno verzijo. Stare verzije prej ne odstranjuj.

## 5. Naloži projekt na GitHub

V CMD v mapi projekta:

```bat
git init
git add .
git commit -m "Fuzijska biopsija 1.4.0 - samodejne posodobitve"
git branch -M main
git remote add origin https://github.com/UPORABNIK/REPO.git
git push -u origin main
```

Če `origin` že obstaja:

```bat
git remote set-url origin https://github.com/UPORABNIK/REPO.git
git push -u origin main
```

Push na `main` zažene **Build Windows EXE**. Rezultat je na GitHubu pod:

```text
Actions → Build Windows EXE → Artifacts
```

Artifact ni samodejna posodobitev. Za updater je potreben objavljen Release.

## 6. Objavi različico 1.4.0

`package.json` mora imeti:

```json
"version": "1.4.0"
```

Nato:

```bat
git tag v1.4.0
git push origin v1.4.0
```

Workflow **Release Windows EXE**:

- preveri ujemanje taga in `package.json`,
- zažene teste,
- zgradi installer,
- ustvari objavljen GitHub Release,
- naloži `.exe`, `latest.yml` in `.blockmap`.

Release ne sme ostati `Draft`. Stabilna aplikacija prav tako ne bere `Pre-release` izdaj.

## 7. Pravi test samodejne posodobitve

Samodejne posodobitve ni mogoče preizkusiti z isto verzijo. Potrebuješ novo, na primer 1.4.1.

### 7.1 Spremeni verzijo

V `package.json` spremeni:

```json
"version": "1.4.1"
```

Dodaj opis spremembe na vrh `CHANGELOG.md`.

### 7.2 Potisni spremembo in tag

```bat
git add .
git commit -m "Verzija 1.4.1"
git push origin main
git tag v1.4.1
git push origin v1.4.1
```

Počakaj, da se workflow konča in preveri, da ima Release tri vrste datotek:

- installer `.exe`,
- `latest.yml`,
- `.blockmap`.

### 7.3 Preveri v nameščeni 1.4.0

Odpri aplikacijo 1.4.0. Po približno 12 sekundah mora:

- zaznati 1.4.1,
- začeti prenos,
- pokazati napredek,
- po prenosu pokazati **Posodobi na 1.4.1**.

Klikni gumb. Aplikacija naredi kopijo baze, se zapre, namesti update in ponovno zažene.

V nastavitvah mora nato pisati:

```text
Nameščena različica: 1.4.1
```

## 8. Kaj se zgodi pred namestitvijo

Aplikacija:

1. s SQLite online-backup mehanizmom ustvari novo samostojno bazo,
2. kopijo ponovno odpre in izvede `PRAGMA quick_check`,
3. poskusi sinhronizirati šifrirani Google Sheets backup, če je nastavljen,
4. tudi če Google trenutno ni dosegljiv, nadaljuje samo, če je lokalna kopija baze uspešna,
5. nato pokliče NSIS updater.

DICOM in PDF mape niso del namestitve ter niso prepisane.

## 9. Če updater ne najde različice

Preveri:

1. repozitorij je javen,
2. GitHub Release je objavljen in ni Draft,
3. Release ni označen kot Pre-release,
4. tag je višji od nameščene verzije,
5. `latest.yml` je pripet v Release,
6. `.exe.blockmap` je pripet v Release,
7. build je bil narejen za isti GitHub repozitorij,
8. internet oziroma službeni proxy dovoljuje `github.com` in `githubusercontent.com`.

Dnevniki so v:

```text
%LOCALAPPDATA%\FuzijskaBiopsija\logs\app.log
```

V aplikaciji jih odpreš z gumbom **Odpri dnevnike napak**.

## 10. Windows opozorilo SmartScreen

Installer trenutno ni podpisan s komercialnim code-signing certifikatom. Windows lahko zato pri prvem zagonu pokaže SmartScreen opozorilo.

To ni napaka updaterja. Dolgoročno je podpisovanje priporočljivo, vendar zahteva ločen certifikat in ni vključeno v to fazo.

## 11. Pravilo za vsako naslednjo izdajo

Vedno upoštevaj vrstni red:

1. spremeni `version` v `package.json`,
2. dopolni `CHANGELOG.md`,
3. lokalno zaženi `npm test`,
4. commit in push na `main`,
5. ustvari tag iste verzije, na primer `v1.4.2`,
6. potisni tag,
7. počakaj na objavljen Release,
8. preveri `.exe`, `latest.yml` in `.blockmap`.

Če tag in `package.json` nista enaka, workflow namerno odpove.
