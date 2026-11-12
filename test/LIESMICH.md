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
