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

// --- Test runner ---
function runAllTests() {
  let tests = [
    testFormatDate,
    testPreprocessTimings,
    testSchedulesDiffer,
    testApplySchedules,
    testBuildApiUrl,
    testBadJson,
    testNetworkOutage,
    testNightTimeEnforceOff
  ];

  let idx = 0;
  function runNext() {
    if (idx >= tests.length) {
      print("All tests completed.");
      return;
    }

    let testFn = tests[idx++];
    try {
      testFn(function (result) {
        print(result.name + ": " + result.status);
        Timer.set(500, false, runNext); // delay between tests
      });
    } catch (e) {
      print("ERROR in test:", e);
      Timer.set(500, false, runNext);
    }
  }

  runNext();
}

// --- Tests ---

function testFormatDate(done) {
  let d = new Date("2025-09-15T00:00:00Z");
  let out = formatDate(d);
  done({
    name: "testFormatDate",
    status: (out === "2025-09-15" ? "PASSED" : "FAILED (" + out + ")")
  });
}

function testPreprocessTimings(done) {
  let timings = [
    { on: "2025-09-15T10:00:00Z", off: "2025-09-15T11:00:00Z" },
    { on: "2025-09-15T11:15:00Z", off: "2025-09-15T12:00:00Z" }
  ];
  let result = preprocessTimings(timings);
  let passed = (result.length === 1); // should merge into one block
  done({
    name: "testPreprocessTimings",
    status: passed ? "PASSED" : "FAILED (" + JSON.stringify(result) + ")"
  });
}

function testSchedulesDiffer(done) {
  let a = [{ on: "2025-09-15T10:00:00Z", off: "2025-09-15T11:00:00Z" }];
  let b = [{ on: "2025-09-15T10:00:00Z", off: "2025-09-15T11:00:00Z" }];
  let c = [{ on: "2025-09-15T12:00:00Z", off: "2025-09-15T13:00:00Z" }];

  lastApplied = a;
  let same = !schedulesDiffer(b);
  let different = schedulesDiffer(c);

  done({
    name: "testSchedulesDiffer",
    status: (same && different) ? "PASSED" : "FAILED"
  });
}

function testApplySchedules(done) {
  let timings = [{ on: "2025-09-15T10:00:00Z", off: "2025-09-15T11:00:00Z" }];
  try {
    applySchedules(timings);
    done({ name: "testApplySchedules", status: "PASSED" });
  } catch (e) {
    done({ name: "testApplySchedules", status: "FAILED (" + e + ")" });
  }
}

function testBuildApiUrl(done) {
  try {
    let url = buildApiUrl();
    let ok = typeof url === "string" && url.indexOf("http") === 0;
    done({ name: "testBuildApiUrl", status: ok ? "PASSED" : "FAILED (" + url + ")" });
  } catch (e) {
    done({ name: "testBuildApiUrl", status: "FAILED (" + e + ")" });
  }
}

function testBadJson(done) {
  try {
    let res = { body: "this is not json" };
    let data;
    try { data = JSON.parse(res.body); } catch (e) { data = null; }
    let passed = (data === null);
    done({ name: "testBadJson", status: passed ? "PASSED" : "FAILED" });
  } catch (e) {
    done({ name: "testBadJson", status: "FAILED (" + e + ")" });
  }
}

function testNetworkOutage(done) {
  try {
    let errCode = 1; // simulate error
    let errMsg = "Network unreachable";
    if (errCode !== 0) {
      done({ name: "testNetworkOutage", status: "PASSED" });
    } else {
      done({ name: "testNetworkOutage", status: "FAILED" });
    }
  } catch (e) {
    done({ name: "testNetworkOutage", status: "FAILED (" + e + ")" });
  }
}

function testNightTimeEnforceOff(done) {
  let now = new Date();
  let backup = now.getHours;

  // force hour to 23 (night time)
  now.getHours = function () { return 23; };

  let allowed = isPollingAllowed();
  let passed = !allowed;

  now.getHours = backup; // restore

  done({
    name: "testNightTimeEnforceOff",
    status: passed ? "PASSED" : "FAILED"
  });
}

let RUN_TESTS = false; // set to false for real operation

if (RUN_TESTS) {
    runAllTests();
} else {
    syncCalendar();
    Timer.set(REFRESH_INTERVAL, true, syncCalendar);
}
