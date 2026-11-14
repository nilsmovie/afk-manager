# Tests

```bash
npm test                  # alle Szenarien (dauert ein paar Minuten)
npm test -- bedrock       # nur Szenarien, deren Dateiname "bedrock" enthält
TEST_LAUT=1 npm test -- 01   # mit der Konsolenausgabe des Managers
```

Jedes Szenario in `szenarien/` startet den echten `server.js` in einem eigenen Ordner unter
`test/.lauf/` – mit nachgebauten Minecraft-Bots (Java und Bedrock) und einem nachgebauten
Discord. Es wird **nichts** nach außen verbunden, kein Microsoft-Login, kein echter Server.
Die Zeit läuft im Zeitraffer (`TEST_ZEITRAFFER`, Standard 40-fach).

Schlägt ein Szenario fehl, steht die Konsole des Managers in `test/.lauf/<szenario>/konsole.log`.
Die Testuhr startet immer um 10:00 Uhr (ein Szenario kann mit `uhrzeit: 22` eine andere Stunde
wählen), damit die Tagesstatistik nicht zufällig um Mitternacht zurückgesetzt wird.

Szenarien 01–12 prüfen das Verhalten mit nur einem Server, 13–21 die Mehrserver-Version
(Serverliste, Java und Bedrock auf weiteren Servern, Microsoft-Login pro Account, Dashboard im
Browser, Discord mit `Name@server`). Der Browser-Teil von Szenario 19 braucht Playwright mit
Chromium; fehlt das, wird nur dieser Teil übersprungen.

Ohne `npm` im Pfad geht dasselbe mit `node test/run.js` (bzw. `node test/run.js bedrock`).
