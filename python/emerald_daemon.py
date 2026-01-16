#!/usr/bin/env python3
import sys
import json
import argparse
import time

from emerald_hws.emeraldhws import EmeraldHWS

def send_response(msg_id, ok, result=None, error=None):
    payload = {"id": msg_id, "ok": ok}
    if ok:
        payload["result"] = result
    else:
        payload["error"] = error or "unknown error"
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    args = parser.parse_args()

    # 1. Initial Login
    try:
        hws = EmeraldHWS(args.email, args.password)
        start_time = time.time()
    except Exception as e:
        sys.stderr.write(f"emerald-daemon: Fatal init error: {e}\n")
        sys.exit(1)

    # 2. Timers
    # We exit the process BEFORE the token expires (usually 10-15 mins).
    # This clears RAM and gets a fresh token automatically upon restart.
    PROCESS_LIFETIME = 600 # 10 Minutes

    # MAIN LOOP
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line: continue
        
        now = time.time()

        # --- RESTART STRATEGY ---
        # Exit cleanly every 10 minutes. 
        # Node.js will restart us in 2 seconds with a fresh token and empty RAM.
        if (now - start_time) > PROCESS_LIFETIME:
            sys.stderr.write("emerald-daemon: Scheduled maintenance restart (RAM/Token).\n")
            sys.exit(0) 

        msg_id = None
        try:
            req = json.loads(line)
            msg_id = req.get("id")
            cmd = req.get("cmd")
            result = None

            if cmd == "discover":
                devices = []
                ids = hws.listHWS()
                for hws_id in ids:
                    info = hws.getInfo(hws_id) or {}
                    name = info.get("serial_number") or info.get("brand") or hws_id
                    devices.append({"id": hws_id, "name": name})
                result = devices

            elif cmd == "status":
                status = hws.getFullStatus(req["hws_id"])
                if status is None: raise Exception("Status returned None")
                result = status

            elif cmd == "set_mode":
                mode = int(req["mode"])
                if mode == 0: hws.setBoostMode(req["hws_id"])
                elif mode == 1: hws.setNormalMode(req["hws_id"])
                elif mode == 2: hws.setQuietMode(req["hws_id"])
                result = {"ok": True, "mode": mode}

            elif cmd == "turn_on":
                hws.turnOn(req["hws_id"])
                result = {"ok": True}

            elif cmd == "turn_off":
                hws.turnOff(req["hws_id"])
                result = {"ok": True}

            else:
                raise Exception(f"Unknown cmd: {cmd}")

            send_response(msg_id, True, result=result)

        except Exception as e:
            # Send error to JS (Allows Offline detection!)
            send_response(msg_id, False, error=str(e))
            sys.stderr.write(f"emerald-daemon: API Error: {e}\n")
            
            # If we hit an API error, it might be an expired token.
            # Force a restart immediately to recover faster than waiting for the timer.
            sys.exit(0)

if __name__ == "__main__":
    main()
