"""S.A.V.I.A - BLE advertisement scanner (prossimita)
Emits JSON lines on stdout:
  {"t":"ready","msg":"scanning"}
  {"t":"adv","mac":"AA:BB:..:FF","name":"...","rssi":-60}
  {"t":"fatal","msg":"..."}
Depends on bleak (pip install bleak). Uses the native Windows BT stack.
"""
import asyncio
import json
import sys
import time

from bleak import BleakScanner

DEDUP_EPSILON = 2  # dBm change to re-emit
DEDUP_TTL = 2.0    # seconds of silence to re-emit anyway


def make_callback():
    last = {}  # mac -> (name, rssi, ts)

    def cb(device, advertisement_data):
        addr = device.address.upper()
        rssi = advertisement_data.rssi
        local = advertisement_data.local_name or device.name or ""
        prev = last.get(addr)
        now = time.monotonic()
        if prev is None:
            pass
        else:
            prev_name, prev_rssi, prev_ts = prev
            if local == prev_name and abs(prev_rssi - rssi) < DEDUP_EPSILON and (now - prev_ts) < DEDUP_TTL:
                return
        last[addr] = (local, rssi, now)
        rec = {"t": "adv", "mac": addr, "name": local, "rssi": rssi}
        sys.stdout.write(json.dumps(rec) + "\n")
        sys.stdout.flush()

    return cb


async def main():
    sys.stdout.write(json.dumps({"t": "ready", "msg": "scanning"}) + "\n")
    sys.stdout.flush()
    scanner = BleakScanner(detection_callback=make_callback(), scanning_mode="active")
    try:
        await scanner.start()
    except Exception as exc:  # noqa: BLE001
        sys.stdout.write(json.dumps({"t": "fatal", "msg": str(exc)}) + "\n")
        sys.stdout.flush()
        return 1
    try:
        while True:
            await asyncio.sleep(1)
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass
    finally:
        try:
            await scanner.stop()
        except Exception:  # noqa: BLE001
            pass
    return 0


if __name__ == "__main__":
    try:
        code = asyncio.run(main())
    except Exception as exc:  # noqa: BLE001
        sys.stdout.write(json.dumps({"t": "fatal", "msg": str(exc)}) + "\n")
        sys.stdout.flush()
        code = 1
    sys.exit(code)