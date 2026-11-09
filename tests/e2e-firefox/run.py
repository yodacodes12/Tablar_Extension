"""Real-Firefox validation for Tablar (Selenium + geckodriver).

Run:  npm run test:e2e:firefox
Uses the E2E build in .output-e2e/firefox-mv3. Firefox's WebDriver cannot script extension
pages, so the checks are driven from a local test page through an E2E-only content-script
bridge (src/entrypoints/e2e-bridge.content.ts, absent from release builds).
"""
import json, os, shutil, socket, subprocess, sys, time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service

ROOT = Path(__file__).resolve().parents[2]
EXT = ROOT / ".output-e2e" / "firefox-mv3"
SITE = "http://127.0.0.1:4517/page"
results = []

def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail and not cond else ""), flush=True)

BRIDGE = """
const [msg, done] = [arguments[0], arguments[arguments.length - 1]];
const id = Math.random();
const on = (e) => { if (e.data && e.data.tablarE2EReply === id) { window.removeEventListener('message', on); done(e.data.res); } };
window.addEventListener('message', on);
window.postMessage({ tablarE2E: id, msg }, '*');
"""

def send(driver, msg):
    res = driver.execute_async_script(BRIDGE, msg)
    if not res or not res.get("ok"):
        raise RuntimeError(f"background error for {msg.get('type')}: {res}")
    return res["data"]

def b(driver, op, **kw):
    return send(driver, {"type": "debug:browser", "op": op, **kw})

def main():
    with socket.socket() as sock:
        in_use = sock.connect_ex(("127.0.0.1", 4517)) == 0
    server = None if in_use else subprocess.Popen(["node", str(ROOT / "tests/e2e/server.mjs")], stdout=subprocess.DEVNULL)
    time.sleep(0.3)
    opts = Options()
    if not os.environ.get("HEADED"):
        opts.add_argument("-headless")
    # Snap installs put a shell wrapper at /usr/bin/firefox; geckodriver needs the real binary.
    snap_bin = Path("/snap/firefox/current/usr/lib/firefox/firefox")
    binary = os.environ.get("FIREFOX_BIN") or (str(snap_bin) if snap_bin.exists() else None)
    if binary:
        opts.binary_location = binary
    # MV3 host permissions are opt-in in Firefox; grant the test bridge's origin at install.
    opts.set_preference("extensions.originControls.grantByDefault", True)
    gecko = os.environ.get("GECKODRIVER") or shutil.which("geckodriver")
    driver = webdriver.Firefox(options=opts, service=Service(executable_path=gecko) if gecko else None)
    driver.set_script_timeout(30)
    try:
        print(f"Firefox {driver.capabilities.get('browserVersion')}", flush=True)
        main_handle = driver.current_window_handle
        driver.install_addon(str(EXT), temporary=True)
        time.sleep(1.5)
        driver.switch_to.window(main_handle)
        driver.get(f"{SITE}/driver")
        ready = False
        for _ in range(50):
            ready = driver.execute_script("return document.documentElement.dataset.tablarBridge") == "ready"
            if ready:
                break
            time.sleep(0.1)
        check("E2E bridge content script injected", ready)
        if not ready:
            raise SystemExit(1)

        snap = send(driver, {"type": "getSnapshot"})
        check("background responds; browser family is firefox", snap["browser"] == "firefox", snap["browser"])
        check("default threshold is 30 min", snap["settings"]["thresholdMinutes"] == 30)
        check("tab discovery lists the driver page", any(t["url"] == f"{SITE}/driver" for t in snap["tabs"]))

        plain = b(driver, "create", props={"url": f"{SITE}/ff-plain"})
        pinned = b(driver, "create", props={"url": f"{SITE}/ff-pinned", "pinned": True})
        fresh = b(driver, "create", props={"url": f"{SITE}/ff-fresh"})
        ago = int(time.time() * 1000) - 45 * 60_000
        for t in (plain, pinned):
            send(driver, {"type": "debug:setLastActive", "tabId": t, "at": ago})
        res = send(driver, {"type": "debug:evaluate"})
        oks = [r for r in res if r["ok"]]
        check("automatic run suspends exactly the eligible tab", len(oks) == 1 and oks[0]["tabId"] == plain, json.dumps(res))
        tab = b(driver, "get", tabId=plain)
        check("native discard: tab kept, discarded, URL preserved", tab["discarded"] and tab["url"] == f"{SITE}/ff-plain", json.dumps(tab)[:200])
        for t, label in ((pinned, "pinned"), (fresh, "recently used")):
            check(f"{label} tab is not suspended", b(driver, "get", tabId=t)["discarded"] is False)

        me = b(driver, "activeTab")
        r = send(driver, {"type": "suspend", "tabIds": [me], "method": "manual-single", "force": True})
        check("active tab refused even when forced", r[0]["ok"] is False, json.dumps(r))
        check("active tab still loaded", b(driver, "get", tabId=me)["discarded"] is False)

        r = send(driver, {"type": "suspend", "tabIds": [pinned], "method": "manual-single"})
        check("protected tab refused without override", r[0]["ok"] is False and "Pinned" in r[0].get("error", ""), json.dumps(r))
        r = send(driver, {"type": "suspend", "tabIds": [pinned], "method": "manual-single", "force": True})
        check("protected tab suspended with explicit override", r[0]["ok"] is True, json.dumps(r))

        r = send(driver, {"type": "suspendAllInactive"})
        check("bulk suspend includes the fresh tab", any(x["ok"] and x["tabId"] == fresh for x in r), json.dumps(r))
        r = send(driver, {"type": "restoreAll"})
        check("restore all succeeds", len(r) >= 3 and all(x["ok"] for x in r), json.dumps(r))
        check("restored tabs are loaded again", all(not b(driver, "get", tabId=t)["discarded"] for t in (plain, pinned, fresh)))
        hist = send(driver, {"type": "getHistory"})
        check(
            "history records all methods with restore times",
            {h["method"] for h in hist} >= {"automatic", "manual-single", "manual-bulk"}
            and all(h.get("restoredAt") for h in hist if h["result"] == "success"),
            json.dumps(hist)[:300],
        )

        mem = send(driver, {"type": "getMemory"})
        caps = mem["capabilities"]
        check("memory: no per-tab / process / system API detected on Firefox", not caps["perTab"] and not caps["perProcess"] and not caps["system"], json.dumps(caps))
        check("memory: estimates never carry byte values", all(m["valueBytes"] is None and m["source"] != "actual" for m in mem["tabs"].values()))

        r = send(driver, {"type": "updateSettings", "patch": {"thresholdMinutes": 10, "whitelist": ["example.com"]}})
        stored = b(driver, "settingsStored")
        check("settings persist to storage", r["ok"] and stored["thresholdMinutes"] == 10 and stored["whitelist"] == ["example.com"], json.dumps(stored))
        alarm = b(driver, "alarm")
        check("scheduler alarm registered (1 min)", alarm and alarm.get("periodInMinutes") == 1, json.dumps(alarm))

        # Firefox's WebDriver cannot script or screenshot privileged extension pages; confirm the
        # dashboard the E2E build opened on install actually loaded in a tab.
        tabs = send(driver, {"type": "getSnapshot"})["tabs"]
        check("extension dashboard page loaded in Firefox", any(t["url"].startswith("moz-extension://") and t["url"].endswith("/dashboard.html") for t in tabs))
    finally:
        driver.quit()
        if server:
            server.terminate()

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed", flush=True)
    sys.exit(1 if failed else 0)

if __name__ == "__main__":
    main()
