# Scheduler for Shelly Devices

A JavaScript scheduler for Shelly smart switches that automatically controls your switch based on calendar events. The script fetches scheduled on/off times from an API, merges overlapping events, and programs the switch accordingly.

## Features

- Fetch schedules from an API for a specific house and calendar.
- Supports **calendar mode** (Monday–Sunday weeks) or **rolling mode** (N days from current day).
- Merges overlapping or close on/off events for efficient operation.
- Allows **pre-timing** by shifting the ON time earlier (`START_PRE` minutes).
- Supports **nighttime pause** to stop polling and enforce switch off.
- Handles network failures, malformed JSON, and other edge cases without crashing.
- Test mode included for safe verification without touching real hardware.

## Configuration

All configuration options are defined at the top of the script.

```javascript
let HOUSE_ID    = "xxxxxxxxx";          // House identifier
let CALENDAR_ID = "xxxxxxxxx";          // Calendar identifier (real or test)
let API_KEY     = "xxxxxxxxx";          // API key
let BASE_URL    = "https://api.kiinteistodata.fi/open-api-v1/properties";

// Scheduler settings
let REFRESH_INTERVAL = 5 * 60 * 1000;   // Fetch interval in ms (default: 5 minutes)
let WEEK_SPAN        = 1;               // Number of full weeks (7-day blocks) to fetch
let MODE             = "calendar";      // "calendar" = Mon–Sun, "rolling" = from today
let START_PRE        = 30;              // Minutes to shift ON times earlier
let END_GAP          = 30;              // Minutes gap to merge consecutive events
let NIGHT_START      = 22;              // Hour to pause polling (24h format)
let NIGHT_END        = 10;              // Hour to resume polling
```

## How it works

1. **Fetch Schedule**  
   The script fetches on/off times from the API for the configured house and calendar.

2. **Preprocess Timings**  
   - Shifts ON times earlier.
   - Merges overlapping or close events (based on `END_GAP`).

3. **Compare and Apply**  
   - Compares the preprocessed schedule to the last applied schedule.
   - If changes exist, deletes old Shelly schedules and programs new ones sequentially.

4. **Nighttime Enforcement**  
   - Polling is paused during nighttime (`NIGHT_START` → `NIGHT_END`).
   - The switch is forcibly turned off during this period.

5. **Testing Mode**  
   - Simulates API fetch and switch toggle.
   - Verifies preprocessing, merging, cron conversion, and night enforcement.

## Running the Script

### Real Mode

```javascript
syncCalendar();
Timer.set(REFRESH_INTERVAL, true, syncCalendar);
```

### Test Mode

```javascript
let RUN_TESTS = true;

if (RUN_TESTS) {
    runAllTests();
} else {
    syncCalendar();
    Timer.set(REFRESH_INTERVAL, true, syncCalendar);
}
```

- Set `RUN_TESTS = true` to run all internal tests.
- Set `RUN_TESTS = false` for normal operation.

## Error Handling

The script is designed to handle common failures gracefully:

- **Network failures** → logs the error, continues operating with last applied schedule.
- **Malformed JSON** → caught and logged, no crash occurs.
- **Empty or missing data** → safely ignored, previous schedule remains active.
- **Multiple consecutive deletions/creations** → sequenced with delays to avoid overloading the device.

## Testing

- Preprocessing merges overlapping events correctly.
- Start-pre shift (`START_PRE`) is applied.
- `schedulesDiffer` correctly detects changes.
- Empty and malformed JSON inputs handled safely.
- Nighttime polling enforcement verified.
- Cron string formatting for Shelly schedules validated.

## Notes

- The Shelly device retains schedules even during network outages.
- For multiple houses or calendars, configure separate instances of the script.
- Adjust `REFRESH_INTERVAL`, `START_PRE`, `END_GAP`, and `WEEK_SPAN` to suit your usage.

## License

BSD 3-Clause License  
See the top of the script for full license text.
