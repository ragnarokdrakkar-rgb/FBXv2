# Faza 7 – rezultat fuzijske biopsije in arhiv

Različica: **1.6.0**

## Potek

Na seznamu naročenih je gumb **Opravil FB**.

### Pozitivna

- pacient se premakne v arhiv,
- rezultat se zapiše kot pozitiven,
- aplikacija zahteva dodatno potrditev,
- vsi evidentirani DICOM in MR PDF dokumenti se trajno izbrišejo,
- v zgodovino se zapišeta rezultat in brisanje,
- če brisanje ni popolno, je v arhivu prikazan gumb **Ponovi izbris dokumentov**.

### Negativna

- pacient se premakne v arhiv,
- rezultat se zapiše kot negativen,
- DICOM in MR PDF ostaneta shranjena,
- dokumenti so še vedno dostopni iz arhiva.

## Varnost

Najprej se rezultat in arhiviranje shranita v SQLite. Šele nato aplikacija briše dokumente. Če pride do napake pri brisanju, pacient ostane pravilno arhiviran, arhiv pa jasno pokaže, da je treba brisanje ponoviti.

## Test

```bat
npm test
2-zazeni.bat
```

Ročni test:

1. dodaj testnega pacienta,
2. dodaj testni DICOM in PDF,
3. naroči ga,
4. klikni **Opravil FB → Pozitivna**,
5. preveri arhiv in fizično mapo dokumentov,
6. ponovi z drugim pacientom in izberi **Negativna**,
7. preveri, da dokumenti drugega pacienta ostanejo.
