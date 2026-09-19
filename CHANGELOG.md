## 0.8.1

- Verwijderd vaste minimale kaarthoogte; Flow-layout past nu echt op de inhoud.
- Kleinere maximale boven- en ondermarge rond de nodes.
- Backup-takken krijgen een eigen kolom zodat verbindingen niet door gewone verbruikers lopen.
- Apparaten achter een backup worden verticaal onder elkaar gestapeld.
- Bestaande 0.8 wrapping van maximaal vijf gewone verbruikers per rij blijft behouden.

# Changelog


## 0.8.0

- Added adaptive sizing to the default Flow layout.
- Removed fixed Flow canvas heights; the card now fits the actual nodes with bounded top/bottom margins.
- Added automatic multi-row wrapping for large numbers of consumers (maximum five slots per row).
- Backup nodes and their downstream consumers are kept together as layout clusters.
- Updated Flow layout labels in Dutch and English.
- Added regression tests for compact height, wrapping and backup clusters.

## v0.7.5

- De gezamenlijke 24-uurs history-load start nu direct op de achtergrond zodra de kaart zichtbaar is, in plaats van pas na een wachttijd.
- Home Assistant zet `hass` opnieuw bij vrijwel iedere state-update. Die updates annuleren de preload niet langer; daardoor kan een snel wijzigende vermogenssensor de history-load niet meer eindeloos uitstellen.
- Geldige `sessionStorage`-grafieken van alle nodes worden bij het laden van de kaart direct teruggezet, zodat navigeren of refreshen binnen de cacheperiode meteen grafieken kan tonen.
- De bestaande gebundelde history-call, vijf-minuten-cache, 96-puntsgrafieken en berekende Woning-historie blijven behouden.
- README uitgebreid met een overzicht van alle releases vanaf v0.7.0.
- Versienummer bijgewerkt naar **0.7.5**.

## v0.7.4

- Alle 24-uurs vermogenshistorie wordt nu met één gebundelde Home Assistant history-request opgehaald in plaats van één request per node.
- Alle nodes worden op dezelfde 96 tijdstippen opnieuw berekend met dezelfde flowlogica als de live kaart.
- **Woning** krijgt nu ook zonder eigen vermogenssensor een echte 24-uursgrafiek, opgebouwd uit de historische energiestromen.
- Ongemeten backup-nodes en batterijen met losse laad-/ontlaadsensoren kunnen eveneens historische grafieken krijgen via de gezamenlijke berekening.
- Detailpopups tonen bij beschikbare historie nu piekvermogen, tijdstip van de piek en gemiddeld vermogen over de grafiekperiode.
- De bestaande geheugen- en `sessionStorage`-cache blijft behouden; na de eerste gezamenlijke laadactie openen alle nodegrafieken direct.
- Versienummer bijgewerkt naar **0.7.4**.

## v0.7.3

- 24-uursgrafieken laden merkbaar sneller door compactere Home Assistant history-requests met `significant_changes_only`.
- Grafiekdata wordt vijf minuten in het geheugen gecachet en daarnaast tijdelijk in `sessionStorage`, zodat opnieuw openen en terugnavigeren vrijwel direct is.
- Dubbele gelijktijdige history-requests voor dezelfde node worden samengevoegd.
- Tot acht veelgebruikte vermogensgrafieken worden na het laden van de kaart rustig op de achtergrond voorverwarmd, met maximaal twee requests tegelijk.
- De grafiek blijft gereduceerd tot 96 punten over 24 uur; de kaart hoeft daardoor nooit duizenden ruwe meetpunten te tekenen.
- Extra tests toegevoegd voor history-query en bucketisering.
- GitHub releaseworkflow gecorrigeerd zodat een repository zonder `package-lock.json` ook correct kan bouwen bij een tag-release.
- Versienummer bijgewerkt naar **0.7.3**.

## v0.7.2

- Kaart iets ruimer gemaakt: grotere standaard rasterhoogte, meer interne ruimte en een grotere maximale flowbreedte.
- Detailpopup staat nu als viewport-overlay boven Home Assistant in plaats van opgesloten in de kaart. Daardoor blijft hij volledig zichtbaar wanneer veel geavanceerde meetwaarden zijn ingesteld.
- Popup is responsief op desktop en mobiel en krijgt een eigen maximale hoogte met scrollen wanneer nodig.
- Taal volgt nu expliciet de actieve Home Assistant frontendtaal per gebruiker/persoon. `hass.locale.language` wordt gebruikt met `hass.language` als fallback.
- Nederlandse en Engelse teksten gelden voor kaart, editor, statussen, popup, grafiek en veldnamen.
- HACS-ready repositorystructuur toegevoegd met README, LICENSE, `hacs.json` en GitHub Actions releaseworkflow.
- Versienummer bijgewerkt naar **0.7.2**.

## v0.7.1

- De standaard energiestroomweergave heet voortaan **Flow**; merk-/productvergelijkingen zijn uit de interface en documentatie verwijderd.
- Bestaande v0.7.0-configuraties met de oude layoutwaarde blijven automatisch werken en worden intern als **Flow** behandeld.
- Verbruikers tonen onder **Geavanceerd** nu relevante meetwaarden: spanning, stroom, vandaag verbruikt en totaal verbruikt.
- Dezelfde verbruiksvelden zijn beschikbaar voor laadpaal, warmtepomp, boiler, airco en backup.
- Extra meetwaarden blijven uit de hoofdweergave en verschijnen alleen in de detailpopup wanneer je op een node klikt.
- Productievelden voor zonnepanelen/producenten blijven als productie gelabeld.
- Versienummer bijgewerkt naar **0.7.1**.

## v0.7.0

- Nieuwe **Flow** energiestroom-layout als standaardweergave: productie boven, net links, opslag rechts en verbruikers onder de woning.
- Home Assistant `ha-entity-picker` voor vermogens- en sensorsvelden; dropdowns blijven open tijdens zoeken/selecteren.
- Naamvelden worden pas naar Home Assistant gecommit na afronden van de invoer, zodat volledige namen behouden blijven.
- Optionele eigen vermogenssensor voor **Woning** (`home_power_entity`); zonder sensor blijft de woning automatisch berekend.
- Onbekende losse bron/apparaatsensoren maken de volledige berekende woningwaarde niet meer automatisch ongeldig zolang er bruikbare energiestromen overblijven.
- Compactere nodes en duidelijkere flowlijnen in de Flow weergave.
- Bestaande `circle` en `straight` layouts blijven beschikbaar.
- Versienummer bijgewerkt naar **0.7.0**.
