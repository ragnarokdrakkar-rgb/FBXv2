# Faza 1 – natančna navodila

## 1. Kaj vsebuje ta verzija

To je prva namizna različica aplikacije **Fuzijska biopsija**.

Glavne spremembe glede na spletno verzijo:

- aplikacija se odpira kot normalen Windows program,
- seznam pacientov ni več shranjen v brskalniškem `localStorage`,
- glavna baza je SQLite datoteka,
- baza je ločena od programa,
- obstoječi uporabniški vmesnik in funkcije ostanejo,
- GitHub lahko sam izdela `Setup.exe`.

V tej fazi še niso vključeni:

- Google Sheets šifrirana cloud kopija,
- DICOM mape,
- PDF izvidi,
- množični prenos na USB,
- avtomatska posodobitev znotraj aplikacije.

Ti deli pridejo v naslednjih fazah. Build in GitHub Release sta že pripravljena.

---

## 2. Zahteve

Potrebuješ:

- Windows 10 ali Windows 11, 64-bit,
- internet za prvo namestitev razvojnih paketov,
- Node.js 24,
- Git samo za nalaganje na GitHub.

Preverjanje Node.js:

```bat
node -v
npm -v
```

Priporočen rezultat je Node `v24.x.x`. Projekt deluje tudi z novejšim Node 22, če je vsaj `22.13.0`, vendar GitHub build uporablja Node 24.

---

## 3. Prvi lokalni zagon

### Najlažji način

1. Razširi ZIP v normalno mapo, na primer:

```text
C:\Users\Ragnar\Desktop\fuzijska-biopsija-desktop-v1.0.0
```

2. Dvoklikni:

```text
1-namesti.bat
```

Ta korak prenese Electron in ostale razvojne pakete. Potreben je samo prvič oziroma po spremembi odvisnosti.

3. Nato dvoklikni:

```text
2-zazeni.bat
```

Odpre se namizna aplikacija.

### Ročno prek CMD

```bat
cd /d "C:\pot\do\fuzijska-biopsija-desktop-v1.0.0"
npm install
npm start
```

---

## 4. Uvoz pacientov iz trenutne spletne aplikacije

Namizna aplikacija ne more sama prebrati podatkov iz Chrome `localStorage`. Prenos narediš enkrat prek JSON izvoza.

### V stari spletni aplikaciji

1. Odpri **Nastavitve**.
2. Klikni **Izvozi JSON**.
3. Shrani datoteko na znano mesto.

### V novi EXE aplikaciji

1. Odpri **Nastavitve**.
2. Klikni **Uvozi JSON**.
3. Izberi prej izvoženo datoteko.
4. Preveri število pacientov in potrdi uvoz.
5. Zapri aplikacijo in jo ponovno odpri.
6. Preveri čakalni seznam, naročene, arhiv in dneve fuzij.

Stare spletne aplikacije ne briši, dokler ne preveriš nove baze.

---

## 5. Kje se fizično shranjujejo podatki

Glavna baza:

```text
%LOCALAPPDATA%\FuzijskaBiopsija\data\fuzijska-biopsija.sqlite
```

Običajno je to nekaj podobnega:

```text
C:\Users\TVOJE_IME\AppData\Local\FuzijskaBiopsija\data\fuzijska-biopsija.sqlite
```

Dnevniki napak:

```text
%LOCALAPPDATA%\FuzijskaBiopsija\logs\app.log
```

Do obeh map lahko prideš neposredno iz aplikacije:

1. Odpri **Nastavitve**.
2. Poišči **Namizna podatkovna baza**.
3. Klikni **Odpri mapo podatkov** ali **Odpri dnevnike napak**.

### Kaj se zgodi pri odstranitvi programa

Installer namesti program drugam kot bazo. Običajni uninstall ne izbriše mape:

```text
%LOCALAPPDATA%\FuzijskaBiopsija
```

Po ponovni namestitvi iste aplikacije se uporabi ista baza.

Za popoln ročni izbris vseh podatkov bi moral po odstranitvi programa posebej izbrisati zgornjo mapo. Tega ne naredi, dokler podatkov res ne želiš trajno odstraniti.

---

## 6. Lokalna izdelava Setup.exe

Najlažje:

```text
3-zgradi-exe.bat
```

Datoteka najprej zažene teste. Če so uspešni, izdela installer:

```text
release\Fuzijska-biopsija-Setup-1.0.0.exe
```

Ročno:

```bat
npm test
npm run dist:win
```

### Windows SmartScreen

Ker installer trenutno ni digitalno podpisan, lahko Windows pokaže opozorilo.

Za lasten test:

1. Klikni **More info / Več informacij**.
2. Klikni **Run anyway / Vseeno zaženi**.

Za širšo uradno distribucijo bo pozneje smiseln certifikat za podpis kode. Podpis ni potreben za razvojni test.

---

## 7. Nalaganje na nov GitHub repozitorij

### Prek spletnega GitHuba

1. Na GitHubu ustvari prazen repozitorij, na primer:

```text
fuzijska-biopsija-desktop
```

2. Ne dodajaj samodejnega README ali `.gitignore`, ker sta že vključena.
3. Naloži **vsebino te projektne mape**, ne ZIP-a kot eno samo datoteko.
4. Preveri, da je naložena tudi mapa:

```text
.github\workflows
```

### Prek CMD

V projektni mapi:

```bat
git init
git add .
git commit -m "Faza 1: Electron EXE in SQLite baza"
git branch -M main
git remote add origin https://github.com/TVOJ-UPORABNIK/fuzijska-biopsija-desktop.git
git push -u origin main
```

`TVOJ-UPORABNIK` zamenjaj s svojim GitHub uporabniškim imenom.

---

## 8. GitHub Actions – avtomatski build

Po vsakem `git push` na vejo `main` se zažene workflow:

```text
.github/workflows/build-windows.yml
```

Postopek:

1. odpri GitHub repozitorij,
2. klikni **Actions**,
3. odpri **Build Windows EXE**,
4. počakaj, da je celoten workflow zelen,
5. na dnu strani odpri **Artifacts**,
6. prenesi ZIP z installerjem.

GitHub artifact vsebuje:

```text
Fuzijska-biopsija-Setup-1.0.0.exe
```

Če se workflow vrti rumeno, ga ne zaganjaj še enkrat takoj. Najprej odpri trenutni workflow in preveri, kateri korak dejansko teče ali je padel.

---

## 9. Izdelava GitHub Release verzije

Release workflow se zažene, ko na GitHub pošlješ tag, ki se začne z `v`.

Za prvo verzijo je `package.json` že nastavljen na:

```text
1.0.0
```

Ustvari tag:

```bat
git tag v1.0.0
git push origin v1.0.0
```

GitHub nato:

- zažene teste,
- izdela installer,
- ustvari GitHub Release,
- pripne `Setup.exe`.

### Naslednja verzija

Primer za `1.0.1`:

```bat
npm version patch --no-git-tag-version
git add package.json package-lock.json
git commit -m "Verzija 1.0.1"
git push
git tag v1.0.1
git push origin v1.0.1
```

Tag in verzija v `package.json` se morata ujemati. Če se ne, release workflow namenoma pade.

---

## 10. Kako je projekt sestavljen

```text
fuzijska-biopsija-desktop-v1.0.0
├── .github\workflows
│   ├── build-windows.yml
│   └── release-windows.yml
├── build
│   ├── icon.ico
│   └── icon.png
├── docs
│   └── FAZA-1-NAVODILA.md
├── scripts
│   ├── smoke-test.cjs
│   └── validate-renderer.cjs
├── src
│   ├── main
│   │   ├── database.cjs
│   │   └── main.cjs
│   ├── preload
│   │   └── preload.cjs
│   └── renderer
│       └── index.html
├── package.json
├── package-lock.json
├── 1-namesti.bat
├── 2-zazeni.bat
└── 3-zgradi-exe.bat
```

### Glavni deli

- `main.cjs`: zažene Electron, okno, SQLite in Windows dialoge.
- `database.cjs`: kreira bazo, migracije, transakcije in notranje kopije.
- `preload.cjs`: omejena varna povezava med vmesnikom in glavnim procesom.
- `index.html`: trenutna aplikacija in uporabniški vmesnik.

Renderer nima neposrednega dostopa do Node.js ali datotečnega sistema.

---

## 11. Kaj obvezno preizkusi pred pravo uporabo

Naredi test z izmišljenimi pacienti:

1. dodaj vsaj tri paciente,
2. zapri in ponovno odpri aplikacijo,
3. preveri, ali so vsi ostali,
4. dodaj dan fuzij,
5. naroči pacienta,
6. spremeni termin,
7. označi enega kot opravljenega,
8. preveri arhiv,
9. izvozi JSON,
10. odstrani in ponovno namesti program,
11. preveri, ali so podatki ostali.

Šele po tem uvozi pravi seznam.

---

## 12. Pogoste težave

### `node` ali `npm` ni prepoznan

Node.js ni nameščen ali CMD ni bil ponovno odprt po namestitvi. Namesti Node.js 24 in ponovno zaženi računalnik oziroma CMD.

### `npm install` pade med prenosom Electron

Preveri internet, proxy ali antivirus. Electron je večja datoteka in prvi prenos lahko traja.

Poskusi:

```bat
rmdir /s /q node_modules
npm cache verify
npm install
```

### EXE build deluje na GitHubu, lokalno pa ne

Uporabi GitHub Actions artifact. Windows GitHub runner ima pravilno build okolje. Lokalno preveri Node verzijo in ponovno zaženi `1-namesti.bat`.

### Aplikacija pokaže napako baze

Ne briši podatkovne mape. Odpri:

```text
%LOCALAPPDATA%\FuzijskaBiopsija\logs\app.log
```

in ohrani tudi:

```text
%LOCALAPPDATA%\FuzijskaBiopsija\data\fuzijska-biopsija.sqlite
```

### Po uvozu ni pacientov

Preveri, da si iz stare aplikacije izvozil JSON, ne CSV. Namizna aplikacija pred uvozom preveri celotno datoteko in neveljaven uvoz zavrne.

---

## 13. Naslednja faza

Naslednja faza je šifrirana cloud kopija seznama pacientov:

- lokalna SQLite baza ostane glavni vir,
- ob spremembi se zapis lokalno šifrira,
- v Google Sheets gre samo šifrirana vsebina,
- brez interneta aplikacija normalno deluje,
- neuspele cloud spremembe čakajo v lokalni vrsti,
- na novem računalniku je mogoče seznam obnoviti z obnovitvenim geslom.
