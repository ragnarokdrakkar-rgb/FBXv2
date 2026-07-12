# Faza 3 – DICOM mape in MR PDF-izvidi

## Kaj prinaša verzija 1.2.0

Aplikacija lahko k vsakemu pacientu lokalno shrani:

- celotno mapo z MR DICOM datotekami,
- MR izvid v PDF obliki.

Aplikacija DICOM datotek ne odpira in ne spreminja. Kopira celotno izbrano mapo, ohrani originalna imena, podmape in datoteko `DICOMDIR`, če obstaja.

## Nadgradnja iz 1.1.0

1. Razširi novi ZIP v novo mapo.
2. Zaženi `1-namesti.bat`.
3. Za test zaženi `2-zazeni.bat`.
4. Preveri, da so obstoječi pacienti in Google Sheets povezava še vidni.
5. Za installer zaženi `3-zgradi-exe.bat`.
6. Namesti `release\Fuzijska-biopsija-Setup-1.2.0.exe` čez obstoječo verzijo.

Lokalna SQLite baza ostane na istem mestu:

```text
%LOCALAPPDATA%\FuzijskaBiopsija\data\fuzijska-biopsija.sqlite
```

Migracija baze iz sheme 1 v shemo 2 se izvede samodejno.

## Glavna mapa dokumentov

Privzeta lokacija je:

```text
%USERPROFILE%\Documents\FuzijskaBiopsijaDokumenti
```

Pred prvim večjim uvozom priporočamo:

1. odpri `Nastavitve`,
2. poišči razdelek `DICOM in MR izvidi`,
3. klikni `Izberi glavno mapo`,
4. izberi disk z dovolj prostora.

Primer:

```text
D:\FuzijskaBiopsijaDokumenti
```

Sprememba glavne mape ne premakne že shranjenih dokumentov. Novi dokumenti se od takrat shranjujejo v novo mapo, stari pa ostanejo na prejšnji lokaciji.

## Dodajanje DICOM mape

1. Na čakalnem seznamu, pri naročenih ali v arhivu klikni `Dokumenti`.
2. Klikni `Dodaj / zamenjaj DICOM mapo`.
3. Izberi najvišjo mapo izvoza MR, ki jo želiš ohraniti.
4. Počakaj, da se končata kopiranje in preverjanje.

Aplikacija pred kopiranjem:

- prešteje vse datoteke,
- izračuna skupno velikost,
- preveri prosti prostor na ciljnem disku.

Po kopiranju za vsako datoteko preveri, da obstaja in ima enako velikost kot izvor. Šele nato zapis označi kot veljaven.

Izvorna mapa se ne premakne in ne izbriše.

## Dodajanje MR izvida PDF

1. Pri pacientu klikni `Dokumenti`.
2. Klikni `Dodaj / zamenjaj MR izvid PDF`.
3. Izberi PDF.

Aplikacija preveri, da je datoteka res PDF, jo kopira in poimenuje približno tako:

```text
123456_Novak_Janez_MR_izvid_2026-07-12_143501_a1b2c3d4.pdf
```

Ime vsebuje matični indeks, priimek, ime, datum dodajanja in unikatno oznako.

## Trenutna in prejšnje različice

Nova DICOM mapa ali novi PDF postane `trenutna` različica. Prejšnja različica ni samodejno izbrisana.

V oknu dokumentov lahko:

- odpreš dokument oziroma DICOM mapo,
- pokažeš dokument v Raziskovalcu,
- trajno izbrišeš izbrane datoteke.

Brisanje dokumenta z diska ni mogoče razveljaviti.

## Struktura map

Primer:

```text
FuzijskaBiopsijaDokumenti
└── Pacienti
    └── 123456_Novak_Janez_ab12cd34
        ├── DICOM_20260712_143000_1a2b3c4d
        │   ├── DICOMDIR
        │   └── SERIES_1
        │       └── IMG0001.dcm
        └── MR_izvidi
            └── 123456_Novak_Janez_MR_izvid_2026-07-12_143501_a1b2c3d4.pdf
```

## Kaj gre v Google Sheets backup

Google Sheets backup še naprej vsebuje samo šifrirani seznam pacientov, termine in nastavitve aplikacije.

V Google Sheets se ne pošiljajo:

- DICOM datoteke,
- PDF-izvidi,
- vsebina izbrane mape dokumentov.

Po obnovitvi na drugem računalniku se seznam pacientov obnovi, dokumente pa je treba ponovno dodati ali prenesti ločeno.

## Preizkus po namestitvi

Naredi test z izmišljenim pacientom:

1. dodaj testnega pacienta,
2. dodaj testno mapo z nekaj datotekami,
3. dodaj testni PDF,
4. zapri in ponovno odpri aplikacijo,
5. preveri zelena statusa `DICOM` in `MR izvid`,
6. odpri oba dokumenta,
7. izbriši testne dokumente prek okna `Dokumenti`,
8. izbriši testnega pacienta.

Prave DICOM mape uporabi šele po uspešnem testu.

## Trenutne omejitve

Verzija 1.2.0:

- ni DICOM pregledovalnik,
- ne bere podatkov iz DICOM glav,
- ne ustvarja nove datoteke `DICOMDIR`,
- še nima množičnega izbora pacientov,
- še nima prenosa celotnega dneva na USB.

Naslednja faza bo množično naročanje in preverjen izvoz DICOM map ter PDF-izvidov naročenih pacientov na USB ali drugo izbrano lokacijo.
