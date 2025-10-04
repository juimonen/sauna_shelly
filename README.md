# Shelly Scheduler

## User Manual (English)

### Overview
This Shelly script controls a switch automatically using schedules fetched from an online calendar.
It can also be switched to **static weekly mode**, where fixed ON/OFF times are configured inside the script.
The device continues running schedules locally even during network outages.

---

### Physical Access
- The Shelly switch is installed in the internal network.
- To configure it, connect your computer to the same local network (via the provided Ethernet switch).
- Open a web browser and go to the Shelly’s local IP address (ask admin if unknown).
- Login → **Scripts** → edit `script`.

---

### Configuration Parameters
At the top of the script you will find parameters:

```js
let REFRESH_INTERVAL = 5 * 60 * 1000; // fetch interval
let WEEK_SPAN        = 1;             // number of weeks
let MODE             = "calendar";    // "calendar", "rolling", or "static"
let START_PRE        = 30;            // start heating X min earlier
let END_OFFSET       = 10;            // turn off X min before end time
let END_GAP          = 30;            // merge events with small gaps
let NIGHT_START      = 22;            // disable polling from 22:00
let NIGHT_END        = 10;            // resume at 10:00
```

- **calendar** = Always fetch Monday–Sunday blocks.
- **rolling** = Always fetch 7 days ahead starting from today.
- **static** = Ignore online calendar, use fixed weekly table.
- **START_PRE** = Minutes to shift ON times earlier (e.g., 30 = start 30 min before scheduled time).
- **END_OFFSET** = Minutes to shift OFF times earlier (e.g., 5 = turn off 5 min before scheduled end time).

---

### Static Weekly Schedule
If `MODE = "static"`, the script uses this table:

```js
let STATIC_SCHEDULE = [
  { day: "MON", on: "16:00", off: "22:00" },
  { day: "TUE", on: "16:00", off: "22:00" },
  { day: "WED", on: "16:00", off: "22:00" },
  { day: "THU", on: "16:00", off: "22:00" },
  { day: "FRI", on: "16:00", off: "23:00" },
  { day: "SAT", on: "14:00", off: "23:00" },
  { day: "SUN", on: "14:00", off: "22:00" }
];
```

To change:
- Edit `on` (start) and `off` (stop) times.
- Use **24-hour format** (`HH:MM`).
- Save → Restart script → Check **Logs**.

---

### Night Mode
Between **22:00 and 10:00**:
- Polling is disabled.
- Script enforces the switch OFF every cycle.
- Calendar syncing resumes automatically after 10:00.

---

### Error Handling
The script is designed to **never crash**. It handles:
- Power loss (schedules remain in device).
- Network outage (local schedules continue).
- Bad JSON / corrupted calendar data (script skips update).
- Manual override (logs show when state changes).

---

### Testing Mode
If `RUN_TESTS = true`, the script will run internal tests instead of syncing schedules.
- Tests cover date formatting, merging events, schedule creation, error cases.
- Results are printed in the **Logs** as `PASSED` or `FAILED`.

---

## Käyttöohje (Suomi)

### Yleiskuvaus
Tämä Shelly-skripti ohjaa kytkintä automaattisesti aikataulujen mukaan, jotka haetaan verkkokalenterista.
Vaihtoehtoisesti voidaan käyttää **staattista viikkoaikataulua**, jolloin ON/OFF -ajat määritellään suoraan skriptiin.
Laite jatkaa aikataulujen suorittamista paikallisesti myös verkkoyhteyden katketessa.

---

### Fyysinen käyttö
- Shelly-kytkin on asennettu sisäverkkoon.
- Konfigurointia varten yhdistä tietokone samaan lähiverkkoon (kytke mukana olevaan verkkokytkimeen).
- Avaa selaimessa Shellyn paikallinen IP-osoite (kysy ylläpitäjältä jos ei tiedossa).
- Kirjaudu sisään → **Scripts** → muokkaa `script`.

---

### Konfigurointiparametrit
Skriptin alussa on seuraavat parametrit:

```js
let REFRESH_INTERVAL = 5 * 60 * 1000; // hakuväli
let WEEK_SPAN        = 1;             // viikkojen määrä
let MODE             = "calendar";    // "calendar", "rolling" tai "static"
let START_PRE        = 30;            // lämmitä X min aiemmin
let END_OFFSET       = 0;             // sammuta X min ennen loppuaikaa
let END_GAP          = 30;            // yhdistä tapahtumat jos lyhyt tauko
let NIGHT_START      = 22;            // tauko klo 22:00 alkaen
let NIGHT_END        = 10;            // jatkuu klo 10:00
```

- **calendar** = Hakee aina maanantai–sunnuntai -blokit.
- **rolling** = Hakee aina 7 päivää eteenpäin nykyisestä päivästä.
- **static** = Ei hae verkosta, käyttää kiinteitä aikoja.
- **START_PRE** = Minuutit, jotka siirtävät käynnistysaikaa aiemmaksi (esim. 30 = käynnistyy 30 min ennen aikataulua).
- **END_OFFSET** = Minuutit, jotka siirtävät sammutusaikaa aiemmaksi (esim. 5 = sammuu 5 min ennen aikataulun loppua).

---

### Staattinen viikkoaikataulu
Jos `MODE = "static"`, skripti käyttää tätä taulukkoa:

```js
let STATIC_SCHEDULE = [
  { day: "MON", on: "16:00", off: "22:00" },
  { day: "TUE", on: "16:00", off: "22:00" },
  { day: "WED", on: "16:00", off: "22:00" },
  { day: "THU", on: "16:00", off: "22:00" },
  { day: "FRI", on: "16:00", off: "23:00" },
  { day: "SAT", on: "14:00", off: "23:00" },
  { day: "SUN", on: "14:00", off: "22:00" }
];
```

Muuttaminen:
- Muokkaa `on` (käynnistys) ja `off` (sammutus) -aikoja.
- Käytä **24h-muotoa** (`HH:MM`).
- Tallenna → Käynnistä skripti uudelleen → Tarkista **Logs**.

---

### Yötila
Välillä **22:00–10:00**:
- Kalenterihaku on pois käytöstä.
- Skripti pakottaa kytkimen pois päältä jokaisella kierroksella.
- Kalenterihaku jatkuu automaattisesti klo 10:00 jälkeen.

---

### Virheenkäsittely
Skripti on suunniteltu **olemaan kaatumatta**. Se käsittelee:
- Sähkökatkon (aikataulut säilyvät laitteessa).
- Verkon katkon (paikalliset aikataulut jatkuvat).
- Virheellisen JSON-/kalenteridatan (skripti ohittaa päivityksen).
- Manuaalisen ohjauksen (lokit näyttävät kun tila muuttuu).

---

### Testitila
Jos `RUN_TESTS = true`, skripti suorittaa sisäiset testit aikataulujen synkronoinnin sijasta.
- Testit kattavat päivämäärien muunnokset, tapahtumien yhdistämisen, aikataulujen luonnin ja virhetilanteet.
- Tulokset näkyvät **Logs**-välilehdellä muodossa `PASSED` tai `FAILED`.
