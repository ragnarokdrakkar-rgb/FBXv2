# Faza 2 – šifrirani backup v Google Sheets prek Apps Script

Ta verzija ne potrebuje Google Cloud Console, plačljivega API-ja ali OAuth JSON-a.

Glavna baza ostane lokalno v SQLite. Google Sheet je samo šifrirana obnovitvena kopija seznama pacientov, terminov in nastavitev. DICOM in PDF datoteke niso vključene.

## 1. Namesti novo EXE verzijo

1. V projektu zaženi `1-namesti.bat`.
2. Za test zaženi `2-zazeni.bat`.
3. Preveri, da so obstoječi pacienti vidni.
4. Za installer zaženi `3-zgradi-exe.bat`.
5. Namesti `release\Fuzijska-biopsija-Setup-1.1.0.exe` čez obstoječo verzijo.

SQLite baza ostane na:

```text
%LOCALAPPDATA%\FuzijskaBiopsija\data\fuzijska-biopsija.sqlite
```

## 2. Ustvari Google Sheet

1. Odpri Google Sheets.
2. Ustvari prazen dokument.
3. Poimenuj ga na primer `Fuzijska biopsija - sifrirani backup`.
4. Dokumenta ne deli z drugimi osebami.

## 3. Dodaj Apps Script

1. V Google Sheetu izberi **Razširitve / Extensions → Apps Script**.
2. Izbriši začetno vsebino datoteke `Code.gs`.
3. Iz tega projekta odpri:

```text
apps-script\Code.gs
```

4. Kopiraj celotno vsebino v Apps Script editor.
5. Shrani projekt.
6. V seznamu funkcij izberi `setupFbxBackup`.
7. Klikni **Run / Zaženi**.
8. Google bo prvič zahteval dovoljenje za dostop do tega Sheeta. Dovoli samo računu, ki je lastnik dokumenta.

Skripta ustvari tri skrite tehnične zavihke:

```text
Meta
Backup_A
Backup_B
```

Vidni zavihek `Navodila` ne vsebuje pacientskih podatkov.

## 4. Objavi Apps Script kot Web App

1. V Apps Script editorju klikni **Deploy → New deployment**.
2. Pri vrsti izberi **Web app**.
3. Description: `Fuzijska biopsija backup v1`.
4. **Execute as:** Me.
5. **Who has access:** Anyone.
6. Klikni **Deploy**.
7. Kopiraj URL, ki se konča z `/exec`.

POMEMBNO: Web app mora biti dostopen kot `Anyone`, ker EXE ne uporablja Google prijave. Dostop pa ni nezaščiten: vsaka zahteva je podpisana z ločenim dolgim ključem in časovno omejena.

## 5. Pridobi dostopni ključ

1. Vrni se v Google Sheet in osveži stran.
2. V meniju se pojavi **Fuzijska backup**.
3. Izberi **Fuzijska backup → Prikaži podatke za povezavo**.
4. Kopiraj:
   - Apps Script Web App URL,
   - dostopni ključ.

Dostopnega ključa ne zapisuj v celice Sheeta, ne objavi ga na GitHubu in ga ne pošiljaj po navadni e-pošti.

Če meni ni viden, v Apps Script editorju ponovno zaženi `setupFbxBackup`, nato osveži Sheet.

## 6. Poveži EXE aplikacijo

V aplikaciji odpri:

```text
Nastavitve → Šifrirana Google Sheets kopija prek Apps Script
```

1. Vnesi Web App URL.
2. Vnesi dostopni ključ.
3. Klikni **1. Shrani in preveri povezavo**.

Pravilno stanje je:

```text
Apps Script povezava deluje. Vnesi novo obnovitveno geslo in ustvari šifrirani backup.
```

## 7. Ustvari šifrirani backup

1. Izberi močno obnovitveno geslo z najmanj 12 znaki.
2. Vnesi ga dvakrat.
3. Klikni **2A. Ustvari nov šifrirani backup**.
4. Nato klikni **Preveri povezavo / backup**.

Obnovitveno geslo shrani izven računalnika. Brez njega pravilno šifriranega backupa ni mogoče obnoviti.

Google ne prejme obnovitvenega gesla ali šifrirnega ključa. EXE lokalno:

1. pripravi posnetek SQLite podatkov,
2. ga stisne,
3. šifrira z AES-256-GCM,
4. razdeli v manjše bloke,
5. pošlje šifrirane bloke Apps Scriptu,
6. zapis ponovno prebere in lokalno dešifrira,
7. šele nato označi sinhronizacijo kot uspešno.

## 8. Samodejno delovanje

Po vsakem novem pacientu ali spremembi:

1. lokalna SQLite baza se shrani takoj,
2. aplikacija po kratkem zamiku poskusi posodobiti Google Sheets kopijo,
3. če internet ne deluje, lokalno delo ostane možno,
4. aplikacija poskusi ponovno pozneje.

Google Sheet uporablja izmenična zapisa `Backup_A` in `Backup_B`. Neuspešen zapis zato ne prepiše zadnje veljavne kopije.

## 9. Obnova na novem računalniku

1. Namesti isto ali novejšo verzijo aplikacije.
2. Vnesi isti Apps Script URL in dostopni ključ.
3. Klikni **Shrani in preveri povezavo**.
4. Vnesi prvotno obnovitveno geslo dvakrat.
5. Klikni **2B. Poveži obstoječi backup**.
6. Klikni **Obnovi lokalno bazo iz clouda**.

Obnovijo se pacienti, termini, statusi in nastavitve. DICOM in PDF dokumenti se ne obnovijo.

## 10. Če dostopni ključ uide

1. V Google Sheetu izberi **Fuzijska backup → Ponastavi dostopni ključ**.
2. Kopiraj novi ključ.
3. V EXE ga ponovno vnesi skupaj z istim Web App URL-jem.

Stari ključ takoj preneha delovati. Šifrirani backup in obnovitveno geslo se ne spremenita.

## 11. Posodobitev Apps Script kode

Če pozneje zamenjaš `Code.gs`:

1. Shrani spremembe.
2. Izberi **Deploy → Manage deployments**.
3. Odpri obstoječi deployment.
4. Izberi **Edit → New version → Deploy**.
5. Običajno ostane isti `/exec` URL.
6. V EXE klikni **Preveri povezavo / backup**.

## 12. Varnostne meje

- V Google Sheets so samo šifrirani bloki; imena, matični indeksi, termini in opombe niso berljivi.
- Apps Script nima šifrirnega ključa.
- Dostopni ključ ščiti endpoint pred nepooblaščenim branjem in prepisovanjem.
- Dostopni ključ je lokalno zaščiten z Windows `safeStorage`.
- Obnovitveno geslo mora biti shranjeno ločeno.
- Sheet naj bo v službenem oziroma organizacijsko dovoljenem Google računu.
- Aplikacija ni nadomestilo za formalno odobritev obdelave zdravstvenih podatkov v ustanovi.
