# Faza 4 – množično naročanje in prenos DICOM/PDF na USB

Verzija: **1.3.0**

Ta verzija doda dve glavni funkciji:

1. označevanje več pacientov na čakalnem seznamu in skupno naročanje na en razpisani dan,
2. preverjen prenos vseh dosegljivih DICOM map in MR PDF-izvidov naročenih pacientov na USB ali v drugo mapo.

## 1. Nadgradnja iz verzije 1.2.0

1. Razširi ZIP v novo mapo.
2. Zaženi `1-namesti.bat`.
3. Za test zaženi `2-zazeni.bat`.
4. Preveri, da so pacienti, termini, dokumenti in Google Sheets povezava še vidni.
5. Za izdelavo installerja zaženi `3-zgradi-exe.bat`.
6. Namesti:

```text
release\Fuzijska-biopsija-Setup-1.3.0.exe
```

Namesti čez obstoječo verzijo. SQLite baza in dokumenti se ne izbrišejo.

Baza se samodejno nadgradi na shemo 3. Predhodni pacienti in dokumenti ostanejo nespremenjeni.

## 2. Množično naročanje pacientov

Na zavihku **Čakalni seznam** ima vsak pacient potrditveno polje:

```text
Izberi za množično naročanje
```

### Postopek

1. Označi paciente, ki jih želiš naročiti.
2. Lahko uporabiš gumb **Izberi prikazane**, če želiš označiti vse trenutno filtrirane paciente.
3. Klikni **Naroči izbrane**.
4. Izberi razpisani dan fuzijskih biopsij.
5. Preveri število prostih mest.
6. Po potrebi spremeni vrstni red pacientov s puščicama gor/dol.
7. Klikni **Naroči vse izbrane**.

Aplikacija dodeli proste 40-minutne termine po prikazanem vrstnem redu.

Primer:

```text
1. Novak Janez  → 08:00
2. Horvat Miha  → 08:40
3. Kovač Ana    → 09:20
```

Če na izbranem dnevu ni dovolj prostih mest, ga ni mogoče izbrati. Najprej povečaj kapaciteto dneva ali dodaj nov dan fuzij v Nastavitvah.

## 3. Priprava dokumentov pred prenosom

Na zavihku **Naročeni** je ob vsakem dnevu gumb:

```text
Pripravi prenos
```

Aplikacija pred kopiranjem pokaže:

- število pacientov,
- približno število datotek,
- skupno velikost,
- pri kom manjka DICOM,
- pri kom manjka MR PDF-izvid.

Če dokument manjka, lahko:

1. zapreš okno in dokument najprej dodaš,
2. ali izrecno potrdiš prenos vseh dosegljivih dokumentov brez manjkajočih datotek.

## 4. Prenos na USB ali drugo lokacijo

1. Klikni **Izberi USB/mapo in prenesi**.
2. Izberi korensko mapo USB-diska ali drugo ciljno mapo.
3. Aplikacija preveri prosti prostor.
4. DICOM in PDF datoteke se kopirajo.
5. Po vsaki kopiji se preveri velikost datoteke.
6. Ko je vse končano, aplikacija ustvari končno mapo in pokaže rezultat.

Obstoječe mape nikoli ne prepiše. Če mapa že obstaja, ustvari na primer:

```text
Fuzije_2026_08_20_2
```

### Struktura izvoza

```text
Fuzije_2026_08_20
├── 01_0800_123456_Novak_Janez
│   ├── DICOM
│   │   ├── DICOMDIR
│   │   └── originalne DICOM podmape in datoteke
│   └── 123456_Novak_Janez_MR_izvid.pdf
├── 02_0840_654321_Horvat_Miha
│   ├── DICOM
│   └── 654321_Horvat_Miha_MR_izvid.pdf
├── seznam_pacientov.csv
└── manifest.json
```

DICOM imena in podmape ostanejo nespremenjeni. Če originalna mapa vsebuje `DICOMDIR`, se tudi ta ohrani.

## 5. Preverjanje prenosa

Aplikacija preveri:

- ali je cilj zapisljiv,
- ali je na cilju dovolj prostora,
- število kopiranih datotek,
- velikost vsake kopirane datoteke,
- skupno število datotek in bajtov.

Gumb **Odpri ciljno mapo** se prikaže šele po uspešnem zaključku.

Pomembno: preverjanje potrdi tehnično enakost velikosti datotek, ne pa medicinske vsebine posamezne DICOM slike.

## 6. Preklic prenosa

Med kopiranjem lahko klikneš **Prekliči prenos**.

Aplikacija:

- dokonča trenutno sistemsko operacijo kopiranja,
- ustavi nadaljnje kopiranje,
- izbriše nedokončano začasno mapo,
- ne pusti lažno označenega končnega izvoza.

USB-ja ne odstrani med kopiranjem. Po koncu uporabi Windows možnost **Varno odstrani strojno opremo**.

## 7. Zgodovina prenosov

V Nastavitvah je razdelek **Zadnji prenosi na USB ali v mapo**.

Prikazuje:

- datum fuzij,
- uspeh, preklic ali napako,
- število prenesenih pacientov,
- skupno velikost,
- gumb za odpiranje uspešne ciljne mape.

Zgodovina je shranjena samo lokalno v SQLite bazi.

## 8. Google Sheets backup

Google Sheets backup ostaja namenjen samo šifriranemu seznamu pacientov, terminom in nastavitvam.

V Google Sheets se ne pošiljajo:

- DICOM datoteke,
- PDF izvidi,
- USB izvozi,
- poti do lokalnih dokumentov.

## 9. Priporočen test pred pravo uporabo

1. Ustvari dva izmišljena testna pacienta.
2. Dodaj obema testno DICOM mapo.
3. Enemu dodaj PDF, drugemu ga namenoma ne dodaj.
4. Oba množično naroči na isti testni dan.
5. Klikni **Pripravi prenos**.
6. Preveri opozorilo za manjkajoči PDF.
7. Prenesi v prazno testno mapo ali USB.
8. Odpri končno mapo in preveri DICOM strukturo, PDF, CSV in manifest.
9. Šele nato uporabi funkcijo z resničnimi podatki.
