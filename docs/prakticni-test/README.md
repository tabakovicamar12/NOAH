# AON – praktični test in interno testiranje

Pripravil: Amar · oktober 2026

Ta dokument določa, kako AON preizkusimo pred uvedbo: najprej skupni praktični test, nato približno en teden internega testiranja na pravem delu. Za navodila po korakih s slikami glejte [Navodila za preizkus](../navodila-za-preizkus/README.md).

Aplikacija: <https://noah-mocha.vercel.app/login>

## 1. Praktični test

Praktični test traja približno eno uro. Udeleženi so vsaj en vodja in dva delavca, vsak na svoji napravi. Vodja dela na računalniku, delavca na telefonih. Testni računi ustvari administrator (`noah-admin`) pred začetkom, kot opisujejo navodila.

### Priprava

- [ ] Administrator je ustvaril račune: 1 vodja, 2 delavca (ista ekipa).
- [ ] Obstaja projekt z vsaj enim objektom, vodja je dodeljen projektu.
- [ ] Delavca imata aplikacijo nameščeno na začetnem zaslonu telefona.
- [ ] Vsi so se enkrat prijavili s povezavo in potrdili obvestilo o zasebnosti.

### Scenarij

Vodja ustvari dva naloga in ju dodeli obema delavcema. Delavca začneta delo, vpisujeta količine, fotografirata, eden prijavi problem, oba končata delo in oddata poročilo. Vodja eno poročilo vrne v popravek, drugo potrdi, nato pregleda delovni čas in izvozi PDF. Med delom en delavec za nekaj minut izgubi povezavo.

### Testni primeri

V stolpec *Rezultat* vpišite **OK** ali **NAPAKA** in kratek opis.

| ID | Vloga | Korak | Pričakovan rezultat | Rezultat |
| --- | --- | --- | --- | --- |
| T-01 | Vodja | Ustvari nalog s količino, rokom in ekipo, klikne *Dodeli ekipi*. | Nalog je v seznamu s statusom *Nov*. | |
| T-02 | Delavec | Osveži seznam nalogov. | Nov nalog je viden na telefonu. | |
| T-03 | Delavec | Pridrži ▶ (ZAČNI DELO) in izbere objekt. | Čas prihoda je zabeležen, na vrhu piše *Na delu od …*. | |
| T-04 | Delavec | Odpre nalog in povleče drsnik ZAČNI NALOG. | Status *V delu*, čas na nalogu teče. | |
| T-05 | Delavec | Doda količino z gumbom in vpiše drugo količino. | Napredek se posodobi. | |
| T-06 | Delavec | Popravi napačno vpisano količino z razlogom. | Količina se zmanjša, popravek je v dnevniku naloga. | |
| T-07 | Delavec | Fotografira, zakrije del slike in shrani. | Fotografija je pri nalogu, zakrito območje ostane zakrito. | |
| T-08 | Delavec | Zapiše opombo. | Opomba je v dnevniku naloga. | |
| T-09 | Delavec | Prijavi problem z opisom. | Status *Problem*, čas na nalogu se ustavi. | |
| T-10 | Vodja | Odpre nalog s problemom. | Vidi opis problema, količine, fotografije in čas. | |
| T-11 | Delavec | Vklopi način za letalo, vpiše količino in opombo. | Na vrhu *Brez povezave*, število čakajočih vnosov se poveča. | |
| T-12 | Delavec | Zapre in znova odpre aplikacijo, še vedno brez povezave. | Vsi vnosi so še vidni. | |
| T-13 | Delavec | Izklopi način za letalo. | V nekaj sekundah *0 v čakanju*; vodja vidi vnose. | |
| T-14 | Delavec | Zaključi drug nalog z drsnikom ZAKLJUČI NALOG. | Status *Zaključen*, vnosi so zaklenjeni. | |
| T-15 | Delavec | Pridrži KONČAJ DELO. | Zabeležen je čas odhoda in skupne ure. | |
| T-16 | Delavec | Dopolni poročilo in ga pridrži za oddajo. | Poročilo *čaka na potrditev*. | |
| T-17 | Vodja | Poročilo prvega delavca vrne v popravek z opombo. | Delavec vidi vrnjeno poročilo in opombo. | |
| T-18 | Delavec | Popravi in znova odda poročilo. | Poročilo znova čaka na potrditev. | |
| T-19 | Vodja | Potrdi obe poročili. | Status *Potrjeno*, časi ostanejo nespremenjeni. | |
| T-20 | Vodja | Odpre *Delovni čas* in izbere delavca. | Ure današnjega dne se ujemajo s poročilom. | |
| T-21 | Vodja | Klikne *Izvozi PDF*. | Odpre se predogled, ki se shrani kot PDF. | |
| T-22 | Delavec | Odpre *Ure*. | Vidi svoje ure v tekočem mesecu. | |

### Merila za uspešen test

Test je uspešen, ko velja vse našteto:

- vsi primeri od T-01 do T-22 so **OK** ali imajo le napake, ki ne vplivajo na zabeležene podatke (npr. besedilo, videz);
- noben vnos se ni izgubil, tudi pri delu brez povezave (T-11 do T-13);
- časi prihoda, odhoda in ure v poročilu se ujemajo z delovnim časom pri vodji (T-20).

## 2. Interno testiranje (približno en teden)

Po uspešnem praktičnem testu aplikacijo uporablja manjša ekipa na pravih nalogih, vzporedno z dosedanjim načinom beleženja. Tako lahko primerjamo rezultate, ne da bi tvegali evidenco.

| Kdaj | Kdo | Kaj |
| --- | --- | --- |
| Vsak delovni dan | Delavci | Začetek in konec dela, nalogi, količine, fotografije, dnevno poročilo v AON. |
| Vsak delovni dan | Vodja | Pregled in potrditev poročil, ustvarjanje novih nalogov. |
| Vsak delovni dan | Vodja | Primerjava ur v AON z dosedanjo evidenco; razlike zapiše. |
| Ob koncu tedna | Vodja | Pregled mesečnega delovnega časa in izvoz PDF. |
| Ob koncu tedna | Vsi | Kratek pogovor ali obrazec spodaj: kaj je delovalo, kaj ne. |

Med testiranjem prosim pazite:

- vnašajte samo podatke, potrebne za delo; ne fotografirajte obrazov in registrskih tablic;
- obvestilo o zasebnosti je še vzorčno, pred trajno uporabo ga pregleda pravnik;
- glasovni vnos še ni vklopljen.

## 3. Sporočanje napak

Za vsako napako ali predlog mi pošljite:

1. ID testnega primera (npr. T-11) ali kratek opis situacije,
2. vlogo in napravo (npr. delavec, Samsung A54, Chrome),
3. kaj ste naredili, kaj ste pričakovali in kaj se je zgodilo,
4. posnetek zaslona, če je mogoče,
5. ali je zaradi napake kak vnos manjkal ali bil napačen.

## 4. Povzetek po testiranju

| Postavka | Odgovor |
| --- | --- |
| Število udeležencev (vodje / delavci) | |
| Število dni testiranja | |
| Ali se je kak vnos izgubil? | |
| Največja težava | |
| Kaj je bilo najbolj koristno | |
| Priporočilo: uvedba / uvedba po popravkih / ni primerno | |

Podpis odgovorne osebe: ______________________ Datum: ____________
