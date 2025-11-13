#!/usr/bin/env python3
from emerald_hws.emeraldhws import EmeraldHWS
import argparse, json, sys

def connect(email, password):
    c = EmeraldHWS(email, password)
    c.connect()
    return c

def info(c, id):
    st = c.getFullStatus(id) or {}
    ls = st.get('last_state', {})
    i = c.getInfo(id) or {}
    return {
        "id": id,
        "name": f"{i.get('brand','Emerald')} {i.get('serial_number',id)}",
        "brand": i.get("brand"),
        "serial_number": i.get("serial_number"),
        "current_temperature": ls.get("temp_current"),
        "target_temperature": ls.get("temp_set"),
        "is_on": c.isOn(id),
        "mode": c.currentMode(id),
        "is_heating": c.isHeating(id)
    }

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--email", required=True)
    p.add_argument("--password", required=True)
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("discover")
    ps = sub.add_parser("status")
    ps.add_argument("--id", required=True)

    pa = sub.add_parser("set")
    pa.add_argument("--id", required=True)
    pa.add_argument("--action", required=True, choices=["on","off","normal","boost","eco"])

    a = p.parse_args()

    try:
        c = connect(a.email, a.password)

        if a.cmd == "discover":
            out=[]
            for id in c.listHWS():
                out.append(info(c,id))
            print(json.dumps({"devices":out}))
            return

        if a.cmd == "status":
            print(json.dumps(info(c,a.id)))
            return

        if a.cmd == "set":
            act=a.action
            if act=="on": c.turnOn(a.id)
            elif act=="off": c.turnOff(a.id)
            elif act=="normal": c.setNormalMode(a.id)
            elif act=="boost": c.setBoostMode(a.id)
            elif act=="eco": c.setQuietMode(a.id)

            print(json.dumps(info(c,a.id)))
            return

    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
