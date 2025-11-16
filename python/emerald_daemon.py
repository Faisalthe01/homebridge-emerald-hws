#!/usr/bin/env python3
import sys
import json
import argparse
import traceback
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


def handle_discover(hws):
    devices = []
    ids = hws.listHWS()

    for hws_id in ids:
        info = hws.getInfo(hws_id) or {}
        name = info.get("serial_number") or info.get("brand") or hws_id
        devices.append({"id": hws_id, "name": name})

    return devices


def handle_status(hws, hws_id):
    status = hws.getFullStatus(hws_id)
    if status is None:
        raise Exception(f"No status for id {hws_id}")
    return status


def handle_set_mode(hws, hws_id, mode):
    if mode == 0:
        hws.setBoostMode(hws_id)
    elif mode == 1:
        hws.setNormalMode(hws_id)
    elif mode == 2:
        hws.setQuietMode(hws_id)
    else:
        raise ValueError("Invalid mode")
    return {"ok": True, "mode": mode}


def handle_turn_on(hws, hws_id):
    hws.turnOn(hws_id)
    return {"ok": True}


def handle_turn_off(hws, hws_id):
    hws.turnOff(hws_id)
    return {"ok": True}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    args = parser.parse_args()

    # START with one session
    hws = EmeraldHWS(args.email, args.password)
    last_reauth = time.time()

    def get_hws(force=False):
        nonlocal hws, last_reauth
        now = time.time()

        # Refresh session every 10 minutes OR if forced
        if force or (now - last_reauth) > 600:
            sys.stderr.write("emerald-daemon: refreshing EmeraldHWS session\n")
            sys.stderr.flush()
            try:
                hws = EmeraldHWS(args.email, args.password)
                last_reauth = now
            except Exception as e:
                sys.stderr.write(f"emerald-daemon: reauth failed: {e}\n")
                sys.stderr.flush()

        return hws

    # MAIN LOOP
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        msg_id = None
        try:
            req = json.loads(line)
            msg_id = req.get("id")
            cmd = req.get("cmd")

            if cmd == "discover":
                hws_inst = get_hws()
                result = handle_discover(hws_inst)

            elif cmd == "status":
                # 1st attempt
                try:
                    hws_inst = get_hws()
                    result = handle_status(hws_inst, req["hws_id"])
                except Exception as e1:
                    # Retry with forced fresh session
                    sys.stderr.write(f"emerald-daemon: status failed ({e1}), retrying with new session\n")
                    sys.stderr.flush()
                    hws_inst = get_hws(force=True)
                    result = handle_status(hws_inst, req["hws_id"])

            elif cmd == "set_mode":
                hws_inst = get_hws()
                result = handle_set_mode(hws_inst, req["hws_id"], int(req["mode"]))

            elif cmd == "turn_on":
                hws_inst = get_hws()
                result = handle_turn_on(hws_inst, req["hws_id"])

            elif cmd == "turn_off":
                hws_inst = get_hws()
                result = handle_turn_off(hws_inst, req["hws_id"])

            else:
                raise Exception(f"Unknown cmd: {cmd}")

            send_response(msg_id, True, result=result)

        except Exception as e:
            send_response(msg_id, False, error=str(e))
            traceback.print_exc(file=sys.stderr)


if __name__ == "__main__":
    main()
