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
let MODE             = "calendar";    // "calendar" = Mon–Sun, "rolling" = today→+N*7-1
let START_PRE        = 30;            // minutes to shift ON times earlier
let END_GAP          = 30;            // minutes gap to merge to next event
let NIGHT_START      = 22;            // pause polling at 22:00
let NIGHT_END        = 10;            // resume polling at 10:00
let lastApplied      = null;

// --- Helpers ---
function pad2(n) { return n < 10 ? "0" + n : "" + n; }

function formatDate(input) {
  var d = (typeof input === "object" && input !== null) ? input : new Date(input);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

// Map JS getDay() (0=Sun..6=Sat) to cron-style day codes
let DOW_MAP = ["SUN","MON","TUE","WED","THU","FRI","SAT"];

// --- Build API URL with MODE ---
function buildApiUrl() {
  var now = Date.now();
  var today = new Date(now);
  var DAY_MS = 86400000;

  var startTs, endTs;

  if (MODE === "calendar") {
    // Monday of current week
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
}

// Compare previous vs new timings
function schedulesDiffer(newTimings) {
  if (!lastApplied) return true;
  try { return JSON.stringify(lastApplied) !== JSON.stringify(newTimings); }
  catch(e){ return true; }
}

// Convert ISO timestamp into cron-style timespec string (persistent schedule)
function toCronString(isoString) {
  let d = new Date(isoString);
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

  // Convert to Date objects and adjust ON times (-START_PRE min)
  let adjusted = [];
  for (let i = 0; i < timings.length; i++) {
    let on = new Date(timings[i].on);
    on = new Date(on.getTime() - START_PRE * 60000); // minus START_GAP minutes
    let off = new Date(timings[i].off);
    adjusted.push({ on: on, off: off });
  }

  // Manual sort by ON time (bubble sort)
  for (let i = 0; i < adjusted.length - 1; i++) {
    for (let j = 0; j < adjusted.length - i - 1; j++) {
      if (adjusted[j].on > adjusted[j + 1].on) {
        let tmp = adjusted[j];
        adjusted[j] = adjusted[j + 1];
        adjusted[j + 1] = tmp;
      }
    }
  }

  // Merge overlapping/close events
  let merged = [];
  let current = adjusted[0];
  for (let i = 1; i < adjusted.length; i++) {
    let next = adjusted[i];
    let gap = (next.on - current.off) / 60000; // minutes

    if (gap <= END_GAP) {
      // Extend current OFF to cover next OFF if later
      if (next.off > current.off) current.off = next.off;
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);

  // Convert back to ISO strings
  let out = [];
  for (let i = 0; i < merged.length; i++) {
    out.push({ on: merged[i].on.toISOString(), off: merged[i].off.toISOString() });
  }
  return out;
}

function deleteAllSchedules(callback) {
  Shelly.call("Schedule.List", {}, function(res) {
    if (!res || !res.jobs || res.jobs.length === 0) {
      print("No schedules found to delete.");
      if (callback) callback();
      return;
    }

    print("Deleting " + res.jobs.length + " schedules...");

    let idx = 0;
    function deleteNext() {
      if (idx >= res.jobs.length) {
        print("All schedules deleted.");
        if (callback) callback(); // signal completion
        return;
      }

      let jobId = res.jobs[idx++].id;
      Shelly.call("Schedule.Delete", { id: jobId }, function(r) {
        print("Deleted job id: " + jobId);
        Timer.set(200, false, deleteNext);
      });
    }

    deleteNext();
  });
}

function applySchedules(timings) {
  if (!timings || timings.length === 0) {
    print("No timings to apply.");
    return;
  }

  print("Applying " + timings.length + " timing pairs…");

  // Step 1: Delete all existing schedules first
  Shelly.call("Schedule.List", {}, function(res) {
    if (!res || !res.jobs) res = { jobs: [] };

    let jobsToDelete = res.jobs.slice(); // copy
    let di = 0;

    function deleteNext() {
      if (di >= jobsToDelete.length) {
        print("All old schedules deleted, now programming new ones…");
        createJobs();
        return;
      }
      let jobId = jobsToDelete[di++].id;
      Shelly.call("Schedule.Delete", { id: jobId }, function(r) {
        print("Deleted job id:", jobId);
        Timer.set(200, false, deleteNext);
      });
    }

    deleteNext();
  });

  // Step 2: Create jobs sequentially
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
      Shelly.call("Schedule.Create", job, function() {
        print("Created job", i, "/", jobs.length);
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
    let on = new Date(t.on);
    let off = new Date(t.off);
    print("  ON :", formatDateTime(on));
    print("  OFF:", formatDateTime(off));
  });
}

function syncCalendar() {
  if (!isPollingAllowed()) {
    print("Polling paused during night hours, force switch off.");
    Shelly.call("Switch.Set", { id: 0, on: false });
    return;
  }
  let url = buildApiUrl();
  Shelly.call("http.get", { url:url }, function(res, errCode, errMsg) {
    if (errCode !== 0) { print("HTTP error:", errMsg); return; }

    let data;
    try { data = JSON.parse(res.body); }
    catch(e) { print("JSON parse error:", e); return; }

    // Always preprocess before anything
    let preprocessed = preprocessTimings(data.timings);

    // Compare to last applied
    if (lastApplied && JSON.stringify(preprocessed) === JSON.stringify(lastApplied)) {
      print("No changes in schedule.");
      return;
    }

    print("Changes detected, applying new schedule...");
    applySchedules(preprocessed);   // <-- send merged, shifted jobs
  });
}

// --- Test mode (print API + toggle switch) ---
let testState = false;
function testApiFlip() {
  let url = buildApiUrl();
  print("TEST: Fetching timings from:", url);

  Shelly.call("http.get", { url:url }, function(res, errCode, errMsg) {
    if(errCode !== 0){ print("TEST: HTTP error:", errMsg); return; }
    let data;
    try{ data = JSON.parse(res.body); } catch(e){ print("TEST: JSON parse error:", e); return; }

    print("TEST: Received timings:", JSON.stringify(data.timings));
    testState = !testState;
    Shelly.call("Switch.Set", { id:0, on:testState });
    print("TEST: Switch toggled to", testState ? "ON":"OFF");
  });
}

// REAL mode: sync API and apply persistent schedules
syncCalendar();
Timer.set(REFRESH_INTERVAL, true, syncCalendar);

// TEST mode: print API and toggle switch
// testApiFlip();
// Timer.set(REFRESH_INTERVAL, true, testApiFlip);
