# Änderungen

## Start-Meldung mit Fortschritt, Servername überall (November 2026)

- Nach einem Neustart des Managers kommt nicht mehr für jeden Server einzeln „Alle Accounts
  wieder online“. Die Meldung „AFK-Manager gestartet“ aktualisiert sich selbst (höchstens alle
  15 Sekunden): pro Server ⏳ 20/26 online, ✅ wenn ein Server komplett ist, und am Ende
  „AFK-Manager gestartet – alle Accounts online“ mit der Dauer.
- Sind nach 20 Minuten noch nicht alle online, wird daraus „nicht alle online“ mit den fehlenden
  Accounts. Für diesen Server kommt dann später wie gewohnt „Alle Accounts wieder online“.
- „Alle Accounts wieder online“, „Alle Accounts offline“ und der Sammel-Kick nennen jetzt auch
  beim Standardserver den Server, z.B. „Alle Accounts wieder online (clashsmp.de)“.
- Selbst gestoppte Accounts zählen bei „Alle Accounts wieder online“ nicht mehr mit – vorher kam
  für einen Server mit einem gestoppten Account diese Meldung nie.

## Discord: kurze Ausfälle nicht mehr über den Webhook (November 2026)

- War Discord kurz nicht erreichbar (Internet weg, z.B. die nächtliche Zwangstrennung des
  Routers, oder eine Störung bei Discord), ist der Manager für 10 Minuten auf den Webhook
  umgestiegen. Die Meldungen kamen dann von „AFK Manager (WH)“, und was während der Störung
  passiert ist, ging verloren.
- Jetzt werden die Meldungen aufgehoben und vom Bot nachgeschickt, sobald Discord wieder
  erreichbar ist: in der richtigen Reihenfolge und mit der Uhrzeit, zu der es passiert ist.
  Das gilt auch für den Chat-Spiegel. Danach geht alles sofort wieder über den Bot.
- Der Webhook springt nur noch ein, wenn der Bot im Kanal nicht schreiben darf (fehlende Rechte,
  Kanal weg) oder Discord länger als 15 Minuten nicht erreichbar ist.
- Im Log steht „Discord: gerade nicht erreichbar …“ und danach „wieder erreichbar (nach ca. N
  Min.) – N aufgehobene Meldung(en) nachgeschickt“.

## iPhone: kein Hineinzoomen, kein Passwort-Vorschlag (November 2026)

- Auf dem iPhone ist Safari beim Neuladen ins Feld „Account hinzufügen“ gesprungen, hat
  hineingezoomt und das gespeicherte Passwort bzw. „Benutzernamen ausfüllen“ vorgeschlagen.
  Das Feld heißt jetzt „Minecraft-Name“, ist für Safari und Passwort-Apps klar kein Login-Feld
  (autocomplete aus, kein „username“ im Namen, kein Formular), und Enter fügt den Account hinzu.
- Alle Eingabefelder und Auswahllisten (auch Farbschema und Schriftart) haben auf Handys und
  Touch-Geräten 16px Schrift – darunter zoomt Safari beim Antippen hinein. Am Computer bleibt alles
  wie bisher. Mit zwei Fingern zoomen geht weiterhin.
- Login-Seite: echtes Formular mit `autocomplete="username"` und `"current-password"`, damit der
  Schlüsselbund nur dort Namen und Passwort einsetzt. Der Cursor springt nur am Computer von
  selbst ins Namensfeld, auf dem Handy nicht. Nach dem Anmelden wird das Dashboard neu geladen –
  das Login-Formular gibt es dort gar nicht.
- Verwaltung: „Benutzer anlegen“ und „Neues Passwort“ schlagen kein gespeichertes Passwort mehr vor.

## Tagesbalken als Zeitleiste (November 2026)

- Der Balken unter jedem Account ist jetzt eine Zeitleiste des Tages: links 0 Uhr, rechts 24 Uhr.
  Markiert ist, zu welcher Uhrzeit der Account wirklich online war – Ausfälle (Kick, Stop,
  Neustart) sind Lücken an der richtigen Stelle. Dunkler Grund = schon vorbei, Strich = jetzt.
  Unterbrechungen unter einer Minute zählen nicht als Lücke.
- Antippen/Anklicken klappt die Uhrzeiten als Liste auf („Online: 10:00–11:00, seit 11:30“),
  darunter 0/6/12/18/24 Uhr. Bleibt beim Aktualisieren der Liste offen.
- Verbindungen auf weiteren Servern haben eine eigene, schmalere Zeitleiste.
- Der Manager merkt sich dafür, wann eine Verbindung on- und offline ging (in `statistik.json`,
  übersteht Neustarts; um Mitternacht beginnt die Zeitleiste neu). Aus einer älteren
  `statistik.json` ohne Uhrzeiten wird die heutige Zeit am Stück bis zum letzten Speichern
  eingezeichnet.

## Tagesbalken = 24 Stunden (November 2026)

- Der Balken unter jedem Account war schon nach 8 Stunden voll – deshalb sah er fast immer voll
  aus. Jetzt steht der ganze Balken für den ganzen Tag (24 Stunden), gefüllt ist der Teil, den der
  Account heute online war (12 h = halber Balken). Feine Striche bei 6, 12 und 18 Stunden; beim
  Drüberfahren steht z.B. „12h 0m von 24 Stunden online (50 %)“. Rechts bleibt die Zeit.

## Menüs am Handy: erst lesen, dann klicken (November 2026)

- Auf iPhone und iPad hat ein Tippen auf ein Item in einem Menü (z.B. /warp) sofort geklickt –
  man landete auf der nächsten Seite, bevor man lesen konnte, was das Item macht. Ursache: Safari
  meldet nach einem Tippen teils „Maus“. Jetzt zählt, womit wirklich gedrückt wurde: Mit dem Finger
  wählt ein Tippen das Item nur aus (wie mit der Maus drüberfahren) – unten stehen Name bzw.
  eigener Name, Verzauberungen und Beschreibung, und man wählt per Knopf Linksklick, Rechtsklick
  oder Abbrechen. Mit der Maus wird weiter direkt geklickt.
- Gilt genauso im normalen Inventar (Item an der Maus ablegen).

## Discord aufräumen (November 2026)

- Neuer Befehl `npm run discord-aufraeumen`: löscht alle Nachrichten des AFK-Managers (Bot und
  seine Webhooks aus der .env) in einem Kanal und Zeitraum – z.B. nach einer Nacht voller Kick-
  und „Alle wieder online“-Meldungen. Nachrichten von Menschen und anderen Bots bleiben stehen.
- Ohne `--loeschen` zeigt er nur an, was er löschen würde; mit `--loeschen` fragt er nochmal nach.
- Mit dem Bot-Recht „Nachrichten verwalten“ in Hunderterpaketen, sonst einzeln; Nachrichten der
  Webhooks werden über den Webhook selbst gelöscht. Siehe ANLEITUNG, Abschnitt 7c.

## Position in der Bewegung (November 2026)

- Die Bewegung zeigt jetzt, wo der ausgewählte Account ist: **Dimension** (🌍 Oberwelt, 🔥 Nether,
  🌌 Ende; auf Servern mit eigenen Welten auch deren Name, z.B. „Welt: hub“), **Koordinaten**
  (Blockkoordinaten wie mit F3) und **Blickrichtung**.
- In Oberwelt und Nether steht die passende Stelle in der anderen Dimension dabei (÷8 bzw. ×8).
- Klick auf die Koordinaten kopiert sie („123 64 -46“).
- Das Inventar wird beim Laufen nicht mehr ständig neu gezeichnet (nur wenn es sich ändert).

## Chat: Hochscrollen bleibt stehen (November 2026)

- Wer im Chat hochscrollt, wird von neuen Nachrichten nicht mehr nach unten geworfen. Stattdessen
  erscheint unten ein Knopf „↓ 3 neue Nachrichten“ – ein Klick (oder selbst runterscrollen)
  springt zurück nach unten. Unten läuft der Chat wie gewohnt mit.
- Auch beim Wechsel des Farbschemas bleibt die Stelle; eigene Nachrichten, ein anderer Server
  oder eine neue Suche springen nach unten.

## Server-Kürzel änderbar (November 2026)

- Das Kürzel eines weiteren Servers (für Discord, z.B. `!start Name@lobby`) lässt sich jetzt in
  der Verwaltung unter „Bearbeiten“ ändern. Alle Verbindungen ziehen mit um: Einstellungen,
  Auto-Chat, Online-Zeit, „gestoppt“-Merker und Chat-Verlauf.
- Laufende Verbindungen auf dem Server werden dafür kurz getrennt und gleich wieder gestartet
  (mit Rückfrage); gestoppte bleiben gestoppt. In Discord gilt sofort das neue Kürzel, der
  Servername funktioniert weiterhin. Die Änderung steht im Protokoll.

## Microsoft lehnt die Anmeldung ab (November 2026)

- Lehnt Microsoft die Anmeldung nach der Code-Eingabe ab (z.B. „user interaction is required“ –
  das Konto braucht eine Bestätigung bei Microsoft), merkt der Manager das jetzt **sofort**. Bisher
  hat er 15 Minuten lang weiter nachgefragt (im Log: „device_code has already been used“), der
  Account stand die ganze Zeit auf „Login nötig“ und bekam danach einfach einen neuen Code.
- Jetzt: Status „Microsoft lehnt Login ab – Konto prüfen“, Erklärung im Chat, die Discord-Meldung
  zeigt den Grund mit Start-Knopf. Der Login pausiert, bis man Start drückt.
- Anfragen an Microsoft haben ein Zeitlimit; „slow_down“ wird beachtet.
- Ein erzwungener Abbruch löst keinen zusätzlichen neuen Verbindungsversuch mehr aus.

## Login-Status nach eingegebenem Code (November 2026)

- Nach erfolgreicher Microsoft-Anmeldung steht beim Account sofort „verbinde...“ statt weiter
  „Login nötig (Code eingeben)“ – auch wenn die Verbindung zum Server noch dauert (bei Bedrock
  oft deutlich länger). Der Code-Kasten verschwindet, die Discord-Meldung zeigt „angemeldet“.
- Fehler behoben: Dauerte die Verbindung nach dem Code länger, als der Code gültig gewesen wäre,
  hat der Manager sie abgebrochen und einen neuen Code verlangt.

## Rechtsklick im Inventar (November 2026)

- **Halben Stapel nehmen wie im Spiel**: Rechtsklick (Maus) auf einen Stapel im Inventar-Widget
  nimmt die Hälfte „an die Maus“; am Handy über „Hälfte nehmen“ beim ausgewählten Item.
- Mit Item an der Maus: Linksklick legt alles ab, Rechtsklick eins (auch zum Tauschen und
  Dazulegen); am Handy Platz antippen, dann „Alles ablegen“ / „Eins ablegen“ / „Abbrechen“.
- Knöpfe „Zurücklegen“ und „Wegwerfen“; andere Aktionen (Verschieben, Droppen, Essen, Craften)
  legen das Item an der Maus vorher von selbst zurück. Klicks stehen im Protokoll.

## Tier auswählen (November 2026)

- Im Widget „Katzenpause“ kann man jetzt per Auswahl das Tier wechseln: **Katze, Hund, Fuchs,
  Hase, Panda, Pinguin oder Axolotl**. Es ändert sich das Tier im Widget (mit eigener Überschrift
  und eigenen Sprüchen) und das Tier, das unten hin und her läuft (der Hase hoppelt, der Pinguin
  watschelt). Die Auswahl merkt sich der Browser.

## Item-Bilder für alle Items (November 2026)

- **Bilder auch für Items ohne eigenes Bild**: `npm run bilder` liest jetzt die Modelle aus dem
  Spiel. Stufen, Treppen, Mauern, Zäune, Knöpfe, Teppiche, gewachste Kupferblöcke und Ähnliches
  zeigen das Bild ihres Blocks; der verzauberte goldene Apfel das des goldenen Apfels.
- **Truhen, Endertruhen, Betten, Köpfe, Banner, Schild und Krug** werden im Spiel als 3D-Modell
  gezeichnet – für sie baut `npm run bilder` ein Bild aus ihrer Textur (Vorderseite bzw. von oben).
- Animierte Texturen (Magma, Meereslaterne …) zeigen nur ihr erstes Bild statt eines Streifens.
- Verzauberter goldener Apfel, Verzauberungsbuch, Erfahrungsfläschchen, Netherstern und
  Enderkristall glitzern wie im Spiel.
- Nach einem neuen `npm run bilder` lädt der Browser die neuen Bilder von selbst (kein Neustart nötig).

## Fenster und Menüs im Inventar (November 2026)

- **Offene Fenster im Dashboard**: Öffnet ein Account im Spiel ein Fenster – eine Kiste, einen
  Ofen oder ein Menü eines Plugins nach einem Befehl –, zeigt das Inventar-Widget dieses Fenster
  wie im Spiel: oben der Inhalt (passendes Raster für Kisten, Trichter, Werkbank, Ofen, Amboss …),
  darunter das eigene Inventar, dazu das Item, das gerade „an der Maus“ hängt.
- Fenstertitel, Item-Namen und **Beschreibungen (Lore)** in den Farben aus dem Spiel; Zeichen
  eigener Menü-Grafiken aus Ressourcenpaketen werden ausgeblendet.
- **Klicken**: mit der Maus direkt Links- und Rechtsklick; am Handy Item antippen und dann
  „Linksklick“, „Rechtsklick“ oder „Abbrechen“. Klick außerhalb („Wegwerfen“) mit Nachfrage.
- **Schließen** mit dem Knopf oder der Esc-Taste. Klicks und Schließen stehen im Protokoll;
  es darf, wer den Account steuern darf.

## Inventar: Verzauberungen, leere Hand, Essen (November 2026)

- **Verzauberungen** werden in allen Minecraft-Versionen erkannt (ab 1.20.5 standen sie nicht
  mehr da, wo sie vorher waren) – auch auf verzauberten Büchern; Anzeige wie im Spiel
  („Schärfe V“, „Reparatur“), beim Drüberfahren und in den Details, Flüche in Rot.
- **Leere Hand**: Klick auf einen leeren Platz der Schnellleiste nimmt ihn in die Hand;
  die Plätze sind nummeriert.
- **Essen und Trinken**: Knopf „Essen“/„Trinken“ bei essbaren Items (legt es in die Hand und
  isst es auf) und als Schnellknopf, wenn Essen in der Hand ist. Satt → verständliche Meldung
  (goldene Äpfel, Tränke, Milch gehen immer).
- **Rechtsklick gedrückt halten** benutzt das Item wie im Spiel (Essen, Trinken, Bogen spannen,
  Schild heben), Loslassen beendet es.

## Inventar und Bewegung (November 2026)

- **Steuerung in zwei Widgets**: „Bewegung“ und „Inventar“, beide immer für denselben Account.
- **Boot fahren**: Sitzt der Account im Boot, fährt W/S und lenkt A/D. Die Bootsfahrt wird wie
  im Spiel nachgerechnet (Wasser, Eis, Land; Halt an Blöcken; Korrekturen vom Server werden
  übernommen). Server mit strengem Anti-Cheat können das als Schummeln werten.
- **Inventar**: Rüstung, Zweithand, Inventar, Schnellleiste und Handwerksfeld mit Anzahl,
  Haltbarkeit, Verzauberung und eigenem Namen; verschieben (Klick oder Ziehen), stapeln,
  „In die Hand“, 1/alle droppen (mit Nachfrage bei Stapeln und besonderen Items), Rezeptliste
  zum Craften (3x3 mit Werkbank in Reichweite). Droppen und Craften stehen im Protokoll.
- **Echte Item-Bilder und deutsche Namen** optional mit `npm run bilder` (lädt sie mit
  EULA-Bestätigung direkt von Mojang nach `item-icons/`, bleibt lokal); sonst eigene Symbole.
- Behoben: „Drop“ in der alten Steuerung hat nie geantwortet (mineflayer arbeitet mit Promises).

## Chat in Farben, Statusleiste pro Server (November 2026)

- **Chat im Dashboard in den Farben wie in Minecraft**: Ränge, Namen und farbige Nachrichten
  (auch Hex-Farben und §-Codes von Plugins), fett/kursiv/unterstrichen. Sehr dunkle bzw. sehr
  helle Farben werden nur so weit angepasst, dass sie auf dem Chat-Hintergrund lesbar bleiben
  (auch im hellen Farbschema). Suche, Export, Discord-Chat und Erweiterungen bekommen weiter
  reinen Text.
- **Kopf des Dashboards**: „Hauptserver“ statt „Zielserver“; bei mehreren Servern eine Anzeige
  „online / gesamt“ pro Server und die Zahl der Accounts insgesamt.

## Mehrere Server (November 2026)

Ein Account kann jetzt **optional** zusätzlich auf weiteren Servern online sein. Wer das nicht
nutzt, merkt fast nichts: Alle Accounts laufen nach dem Update unverändert auf dem
Standardserver weiter, ohne Neueinrichtung und ohne neuen Microsoft-Login.

### Neu

- **Verwaltung → Server**: weitere Server anlegen, ändern, löschen (Owner und Admin) – Name,
  Kürzel für Discord, Adresse, Java- und/oder Bedrock-Port, Auto-Chat-Vorlage. Der
  Standardserver kommt weiter aus der `.env`.
- **Dashboard**: „+ Server“ beim Account, eine Zeile pro weiterem Server (Status, Start/Stop,
  Online-Zeit, ★, 🔔, eigener Auto-Chat, ✕), Chat-Umschalter pro Server, Steuerung über
  weitere Server.
- **Discord**: `Name@kürzel` bzw. `Name@alle` bei `!start`, `!stop`, `!mc`, `!primary`;
  `!add Name@kürzel` schickt einen bestehenden Account zusätzlich auf einen Server; `!list`
  zeigt die weiteren Server; Meldungen und Knöpfe nennen den Server.
- **Pro Verbindung**: Status, „schon mal drin“ (kein Auto-Chat beim allerersten Join),
  Auto-Chat, Glocke, Online-Zeit, Reconnect. **Pro Server**: Chat und Chat-Quelle,
  Kick-Sammelmeldungen, „Alle offline/online“, Bedrock-Pause, NetherNet/RakNet-Erkennung.
- **Microsoft-Login pro Account**: Code-Zähler und Pause gelten für alle Verbindungen eines
  Accounts; solange ein Code offen ist, warten die anderen Verbindungen (nie zwei Logins für
  denselben Login-Cache gleichzeitig). Die Warteschlange bleibt eine für alle Server.
- **Schalter** in der `.env`: `MULTI_SERVER_JAVA` (Standard an), `MULTI_SERVER_BEDROCK`
  (Standard aus), `MULTI_SERVER_BEDROCK_MAX` (Standard 2).
- **Tageszusammenfassung** mit eigenem Abschnitt pro weiterem Server.
- **Protokoll**: Server und Verbindungen anlegen/ändern/entfernen, alle Aktionen mit dem
  Server im Ziel (z.B. `NilsMovie@lobby`).
- **Erweiterungen**: Schnittstelle unverändert; neu sind ein optionaler Server bei
  `sendChatMessage(name, text, server)` und `isAccountOnline(name, server)`, `getServers()`
  und das Feld `server` bei `onChat` (kommt weiterhin nur vom Standardserver).
- **Tests**: `npm test` (21 Szenarien, nachgebaute Bots, nichts wird nach außen verbunden).

### Behoben

- **Server mit eigenem Ressourcenpaket** (Java): Accounts flogen nach wenigen Sekunden mit
  „An internal error occurred in your connection.“ raus, weil mineflayer das Paket während der
  Anmeldung nicht beantwortet hat. mineflayer ist jetzt auf 4.39 aktualisiert (beantwortet es
  dort selbst und schickt in dieser Phase keine Bewegungspakete mehr); kommt ein Paket später im
  Spiel, nimmt der Manager es an. Heruntergeladen wird nichts – ein AFK-Bot braucht keine
  Texturen. Nach dem Update ist `npm install` nötig.

- **Gestoppt bleibt gestoppt**: Accounts (und Verbindungen zu weiteren Servern), die vorher
  gestoppt waren – per Stop, `!stop`, „Alle stoppen“, „anderswo eingeloggt“ oder neu angelegt
  und noch nicht gestartet –, startet ein Neustart des Managers nicht mehr. Sie bleiben aus, bis
  jemand auf Start drückt. Gespeichert als `"stopped": true` in `accounts.json` bzw.
  `verbindungen.json` (ältere Versionen ignorieren das). Beim ersten Neustart nach dem Update
  starten noch alle, weil es den Merker vorher nicht gab.

- **Tageszusammenfassung übersteht Neustarts**: Die Online-Zeiten von heute stehen jede Minute
  in `statistik.json`; nach einem Neustart am selben Tag zählen sie weiter (die Zeit, in der der
  Manager aus war, zählt nicht). War der Manager um Mitternacht aus, wird die Zusammenfassung
  des Vortags beim Start nachgeholt. Ein Neustart kurz nach Mitternacht schickt sie auch nicht
  mehr doppelt.

### Behoben (schon vor dieser Version)

- Ein im Dashboard oder per `!stop` gestoppter Account zählte in der Online-Zeit weiter, bis er
  wieder gestartet wurde – die Tageszusammenfassung war für gestoppte Accounts zu hoch.

### Geändert

- **„Alle Accounts wieder online“ ist ruhiger**: Die Meldung kommt nur nach einem echten
  Ausfall (nach „Alle offline“, einem Massen-Kick, dem Start des Managers oder wenn ein
  Account länger als `DISCORD_ALL_ONLINE_AFTER_MIN` Minuten weg war, Standard 10). Ein
  einzelner Account, der kurz rausfliegt, löst keine Meldung mehr aus.
- **Kein fest eingebauter Server mehr**: Ohne `MC_SERVER_HOST` in der `.env` startet kein
  Account (Meldung in Log, Dashboard und Discord). In der `.env.example` steht weiter
  `clashsmp.de`.
- „Alle starten/stoppen“ und `!start all`/`!stop all` gelten für alle Server.
- Umbenennen geht nur, wenn der Account auf allen Servern gestoppt ist.
- `!list` markiert jetzt die tatsächliche Chat-Quelle (vorher immer den ersten Account).
- Die Seite „Benutzerverwaltung“ heißt jetzt „Verwaltung“.

### Dateien

- Neu (bleiben lokal, nie im Repository): `servers.json`, `verbindungen.json` (jeweils mit
  `.backup.json`) und einmalig `accounts.vor-mehrserver.json` – eine unveränderte Kopie der
  `accounts.json` vom ersten Start dieser Version.
- `accounts.json` behält ihr Format. Ältere Versionen ignorieren die neuen Dateien.

### Update

```bash
cd ~/afk-manager
grep MC_SERVER_HOST .env     # muss eine Adresse zeigen, z.B. MC_SERVER_HOST=clashsmp.de
git pull
npm install                  # nötig: neue mineflayer-Version
sudo systemctl restart afk-manager
```

Die Warnungen „EBADENGINE … required: { node: '>=24' }“ bei `npm install` (bedrock-protocol,
nethernet …) gab es schon vorher, sie sind harmlos.

### Zurück zur Version davor

```bash
cd ~/afk-manager
git log --oneline            # die Version vor "Mehrere Server" heraussuchen
git checkout <nummer>
npm install                  # passende Paketversionen dieser Version
sudo systemctl restart afk-manager
```

Die Accounts laufen dann wieder nur auf dem Standardserver, ohne neuen Login.
`servers.json` und `verbindungen.json` bleiben liegen und werden beim nächsten Update wieder
benutzt.
