/**
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Copyright (c) 2025, Jaska Uimonen
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice,
 *    this list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 *
 * 3. Neither the name of the copyright holder nor the names of its
 *    contributors may be used to endorse or promote products derived from
 *    this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

let HOUSE_ID    = "xxxxxxxxx";
//let CALENDAR_ID = "xxxxxxxxx"; // real calendar
let CALENDAR_ID = "xxxxxxxxx";  // test calendar 
let API_KEY     = "xxxxxxxxx";
let BASE_URL    = "https://api.kiinteistodata.fi/open-api-v1/properties";

// === Config ===
let REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes
let WEEK_SPAN        = 1;             // number of full weeks (7-day blocks)
let MODE             = "calendar";    // "calendar" or "rolling"
let START_PRE        = 30;            // minutes to shift ON times earlier
let END_GAP          = 30;            // minutes gap to merge to next event
let NIGHT_START      = 22;            // pause polling at 22:00
let NIGHT_END        = 10;            // resume polling at 10:00
let lastApplied      = null;
let FAILED_SYNC_COUNT = 0;
let FAILED_SYNC_THRESHOLD = 5;

// --- Helpers ---
function pad2(n) { return n < 10 ? "0" + n : "" + n; }

function formatDate(input) {
  var d = (typeof input === "object" && input !== null) ? input : new Date(input);
  if (isNaN(d.getTime())) return "1970-01-01"; // fallback
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

let DOW_MAP = ["SUN","MON","TUE","WED","THU","FRI","SAT"];

function safeDate(str) {
  let d = new Date(str);
  if (isNaN(d.getTime())) {
    print("Invalid date:", str);
    return null;
  }
  return d;
}

// --- Build API URL with MODE ---
function buildApiUrl() {
  try {
    var now = Date.now();
    var today = new Date(now);
    var DAY_MS = 86400000;

    var startTs, endTs;

    if (MODE === "calendar") {
      var day = today.getDay(); // 0=Sun
      var mondayOffset = (day === 0 ? -6 : 1 - day);
      var mondayTs = now + mondayOffset * DAY_MS;

      var mondayDate = new Date(mondayTs);
      var mondayStartTs = mondayTs - (
        mondayDate.getHours() * 3600000 +
        mondayDate.getMinutes() * 60000 +
        mondayDate.getSeconds() * 1000 +
        mondayDate.getMilliseconds()
      );

      startTs = mondayStartTs;
      endTs   = startTs + (7 * WEEK_SPAN - 1) * DAY_MS;

    } else { // rolling
      var todayStartTs = now - (
        today.getHours() * 3600000 +
        today.getMinutes() * 60000 +
        today.getSeconds() * 1000 +
        today.getMilliseconds()
      );

      startTs = todayStartTs;
      endTs   = startTs + (7 * WEEK_SPAN * DAY_MS) - DAY_MS;
    }

    var start = new Date(startTs);
    var end   = new Date(endTs);

    print("Computed window:", formatDate(start), "->", formatDate(end));

    return BASE_URL + "/" + HOUSE_ID +
           "/calendars/" + CALENDAR_ID +
           "/timings/" + formatDate(start) + "/" + formatDate(end) +
           "/?api_key=" + API_KEY;
  } catch (e) {
    print("Error building API URL:", e);
    return null;
  }
}

function schedulesDiffer(newTimings) {
  if (!lastApplied) return true;
  try { return JSON.stringify(lastApplied) !== JSON.stringify(newTimings); }
  catch(e){ return true; }
}

function toCronString(isoString) {
  let d = safeDate(isoString);
  if (!d) return "0 0 0 * * MON"; // safe fallback
  let sec = d.getSeconds();
  let min = d.getMinutes();
  let hr  = d.getHours();
  let dow = DOW_MAP[d.getDay()];
  return sec + " " + min + " " + hr + " * * " + dow;
}

function isPollingAllowed() {
  let now = new Date();
  let hr = now.getHours();
  return !(hr >= NIGHT_START || hr < NIGHT_END);
}

function preprocessTimings(timings) {
  if (!timings || timings.length === 0) return [];

  let adjusted = [];
  for (let i = 0; i < timings.length; i++) {
    let on = safeDate(timings[i].on);
    let off = safeDate(timings[i].off);
    if (!on || !off) continue;
    on = new Date(on.getTime() - START_PRE * 60000);
    adjusted.push({ on: on, off: off });
  }

  if (adjusted.length === 0) return [];

  // Sort manually
  for (let i = 0; i < adjusted.length - 1; i++) {
    for (let j = 0; j < adjusted.length - i - 1; j++) {
      if (adjusted[j].on > adjusted[j + 1].on) {
        let tmp = adjusted[j];
        adjusted[j] = adjusted[j + 1];
        adjusted[j + 1] = tmp;
      }
    }
  }

  // Merge
  let merged = [];
  let current = adjusted[0];
  for (let i = 1; i < adjusted.length; i++) {
    let next = adjusted[i];
    let gap = (next.on - current.off) / 60000;

    if (gap <= END_GAP) {
      if (next.off > current.off) current.off = next.off;
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);

  let out = [];
  for (let i = 0; i < merged.length; i++) {
    out.push({ on: merged[i].on.toISOString(), off: merged[i].off.toISOString() });
  }
  return out;
}

function deleteAllSchedules(callback) {
  Shelly.call("Schedule.List", {}, function(res, errCode, errMsg) {
    if (errCode !== 0 || !res || !res.jobs) {
      print("Schedule.List error:", errMsg);
      if (callback) callback();
      return;
    }

    if (res.jobs.length === 0) {
      print("No schedules found to delete.");
      if (callback) callback();
      return;
    }

    print("Deleting " + res.jobs.length + " schedules...");

    let idx = 0;
    function deleteNext() {
      if (idx >= res.jobs.length) {
        print("All schedules deleted.");
        if (callback) callback();
        return;
      }

      let jobId = res.jobs[idx++].id;
      Shelly.call("Schedule.Delete", { id: jobId }, function(r, errCode, errMsg) {
        if (errCode !== 0) {
          print("Failed to delete job", jobId, ":", errMsg);
        } else {
          print("Deleted job id:", jobId);
        }
        Timer.set(200, false, deleteNext);
      });
    }

    deleteNext();
  });
}

function applySchedules(timings) {
  if (!timings || timings.length === 0) {
    print("No timings to apply, enforcing OFF.");
    Shelly.call("Switch.Set", { id: 0, on: false });
    return;
  }

  print("Applying " + timings.length + " timing pairs…");

  Shelly.call("Schedule.List", {}, function(res, errCode, errMsg) {
    if (errCode !== 0 || !res || !res.jobs) {
      print("Schedule.List error:", errMsg);
      createJobs();
      return;
    }

    let jobsToDelete = res.jobs.slice();
    let di = 0;

    function deleteNext() {
      if (di >= jobsToDelete.length) {
        print("All old schedules deleted, now programming new ones…");
        createJobs();
        return;
      }
      let jobId = jobsToDelete[di++].id;
      Shelly.call("Schedule.Delete", { id: jobId }, function(r, errCode, errMsg) {
        if (errCode !== 0) {
          print("Delete failed for job", jobId, ":", errMsg);
        } else {
          print("Deleted job id:", jobId);
        }
        Timer.set(200, false, deleteNext);
      });
    }

    deleteNext();
  });

  function createJobs() {
    let jobs = [];
    timings.forEach(function(t) {
      jobs.push({
        enable: true,
        timespec: toCronString(t.on),
        calls: [{ method: "Switch.Set", params: { id: 0, on: true } }]
      });
      jobs.push({
        enable: true,
        timespec: toCronString(t.off),
        calls: [{ method: "Switch.Set", params: { id: 0, on: false } }]
      });
    });

    print("Programming " + jobs.length + " jobs…");

    let i = 0;
    function createNext() {
      if (i >= jobs.length) {
        lastApplied = JSON.parse(JSON.stringify(timings));
        print("All schedules applied at", new Date().toString());
        printHumanSchedule(timings);
        return;
      }
      let job = jobs[i++];
      Shelly.call("Schedule.Create", job, function(r, errCode, errMsg) {
        if (errCode !== 0) {
          print("Failed to create job", i, "/", jobs.length, ":", errMsg);
        } else {
          print("Created job", i, "/", jobs.length);
        }
        Timer.set(200, false, createNext);
      });
    }

    createNext();
  }
}

function formatDateTime(d) {
  return pad2(d.getDate()) + "." + pad2(d.getMonth()+1) + "." + d.getFullYear() + " " +
         pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
}

function printHumanSchedule(timings) {
  print("Scheduled events:");
  timings.forEach(function(t) {
    let on = safeDate(t.on);
    let off = safeDate(t.off);
    if (!on || !off) return;
    print("  ON :", formatDateTime(on));
    print("  OFF:", formatDateTime(off));
  });
}

function notifyNetworkIssue() {
  // Example: send via Shelly HTTP request or print
  print("Network issue: calendar sync failed " + FAILED_SYNC_COUNT + " times!");
  // Optional: Shelly.call("http.request", { url: "https://server/notify?msg=network_down" });
}

function syncCalendar() {
  if (!isPollingAllowed()) {
    print("Polling paused during night hours, force switch off.");
    Shelly.call("Switch.Set", { id: 0, on: false });
    return;
  }

  let url = buildApiUrl();
  if (!url) return;

  Shelly.call("http.get", { url:url }, function(res, errCode, errMsg) {
    if (errCode !== 0) {
      print("HTTP error:", errMsg);
      FAILED_SYNC_COUNT++;
      if (FAILED_SYNC_COUNT >= FAILED_SYNC_THRESHOLD) {
        notifyNetworkIssue();
        FAILED_SYNC_COUNT = 0; // reset after alert
      }
      return;
    }

    // Reset counter on successful fetch
    FAILED_SYNC_COUNT = 0;

    let data;
    try { data = JSON.parse(res.body); }
    catch(e) { print("JSON parse error:", e); return; }

    if (!data || !Array.isArray(data.timings)) {
      print("Invalid API response, no timings array.");
      return;
    }

    let preprocessed = preprocessTimings(data.timings);
    if (preprocessed.length === 0) {
      print("No valid timings found, enforcing OFF.");
      Shelly.call("Switch.Set", { id: 0, on: false });
      return;
    }

    if (lastApplied && JSON.stringify(preprocessed) === JSON.stringify(lastApplied)) {
      print("No changes in schedule.");
      return;
    }

    print("Changes detected, applying new schedule...");
    applySchedules(preprocessed);
  });
}

let RUN_TESTS = false; // set to false for real operation

if (RUN_TESTS) {
    runAllTests();
} else {
    syncCalendar();
    Timer.set(REFRESH_INTERVAL, true, syncCalendar);
}

function runAllTests() {
    console.log("=== Running test suite ===");
    let results = [];

    function runTest(name, fn) {
        try {
            fn();
            results.push({ name, status: "PASSED" });
        } catch (e) {
            results.push({ name, status: "FAILED", error: e.message });
        }
    }

    // --- Test 1: Preprocess merges overlapping events ---
    runTest("Preprocess merge test", function() {
        let input = [
            { on: "2025-09-12T10:30:00Z", off: "2025-09-12T11:00:00Z" },
            { on: "2025-09-12T10:45:00Z", off: "2025-09-12T11:15:00Z" }
        ];
        let output = preprocessTimings(input);
        if (output.length !== 1) throw new Error("Merge failed");
    });

    // --- Test 2: Preprocess applies START_PRE ---
    runTest("Start pre adjustment test", function() {
        let input = [{ on: "2025-09-12T10:30:00Z", off: "2025-09-12T11:00:00Z" }];
        let output = preprocessTimings(input);
        let expectedOn = new Date("2025-09-12T10:00:00Z").toISOString(); // START_PRE = 30
        if (output[0].on !== expectedOn) throw new Error("START_PRE not applied correctly");
    });

    // --- Test 3: Schedules differ logic ---
    runTest("Schedules differ test", function() {
        lastApplied = [{ on: "2025-09-12T10:00:00Z", off: "2025-09-12T11:00:00Z" }];
        let newTimings = [{ on: "2025-09-12T10:00:00Z", off: "2025-09-12T11:00:00Z" }];
        if (schedulesDiffer(newTimings)) throw new Error("Should not detect changes");
        newTimings = [{ on: "2025-09-12T10:05:00Z", off: "2025-09-12T11:00:00Z" }];
        if (!schedulesDiffer(newTimings)) throw new Error("Should detect changes");
    });

    // --- Test 4: Empty timings ---
    runTest("Empty timings test", function() {
        let output = preprocessTimings([]);
        if (!Array.isArray(output) || output.length !== 0) throw new Error("Empty timings failed");
    });

    // --- Test 5: Malformed input ---
    runTest("Malformed input test", function() {
        try {
            preprocessTimings(null);
            preprocessTimings(undefined);
        } catch (e) {
            throw new Error("Malformed input caused error");
        }
    });

    // --- Test 6: Cron string correctness ---
    runTest("Cron string test", function() {
        let iso = "2025-09-12T10:30:45Z";
        let cron = toCronString(iso);
        if (!cron.match(/45 30 10 \* \* \w{3}/)) throw new Error("Cron string format invalid: " + cron);
    });

    // --- Test 7: Nighttime enforcement ---
    runTest("Nighttime enforcement test", function() {
        let originalNIGHT_START = NIGHT_START;
        let originalNIGHT_END = NIGHT_END;

        NIGHT_START = 22;
        NIGHT_END = 10;

        let oldDate = new Date();
        let testDate = new Date();
        testDate.setHours(23);
        Date = class extends Date {
            constructor() { super(); return testDate; }
        };
        if (isPollingAllowed()) throw new Error("Polling should be paused at 23:00");

        testDate.setHours(11);
        if (!isPollingAllowed()) throw new Error("Polling should be allowed at 11:00");

        NIGHT_START = originalNIGHT_START;
        NIGHT_END = originalNIGHT_END;
        Date = oldDate.constructor;
    });

    // --- Summary ---
    console.log("=== Test results ===");
    results.forEach(r => {
        console.log(r.name, ":", r.status, r.error ? "(" + r.error + ")" : "");
    });
    console.log("=== Tests completed ===");
}
