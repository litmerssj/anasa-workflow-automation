from __future__ import annotations

import shutil
import signal
import socket
import subprocess
import sys
import time

from .config import PACKAGE_ROOT


def _port_open(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.3):
            return True
    except OSError:
        return False


def main() -> None:
    processes: list[subprocess.Popen] = []
    temporal_owned = False
    if not _port_open(7233):
        temporal = shutil.which("temporal")
        if not temporal:
            raise SystemExit("Temporal CLI is missing. Install it with: brew install temporal")
        data_dir = PACKAGE_ROOT / ".temporal"
        data_dir.mkdir(parents=True, exist_ok=True)
        processes.append(
            subprocess.Popen(
                [
                    temporal,
                    "server",
                    "start-dev",
                    "--db-filename",
                    str(data_dir / "temporal.db"),
                ],
                cwd=PACKAGE_ROOT,
            )
        )
        temporal_owned = True
        for _ in range(100):
            if _port_open(7233):
                break
            time.sleep(0.1)
        else:
            raise SystemExit("Temporal server did not start")

    processes.append(
        subprocess.Popen(
            [sys.executable, "-m", "anasa_orchestrator.worker"],
            cwd=PACKAGE_ROOT,
        )
    )

    print("ANASA worker is ready for the Codex app plugin.")
    print("Temporal UI: http://localhost:8233")
    print("Press Ctrl-C to stop the worker.")

    stopping = False

    def stop(*_: object) -> None:
        nonlocal stopping
        if stopping:
            return
        stopping = True
        for process in reversed(processes):
            if process.poll() is None:
                process.terminate()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    try:
        while not stopping:
            for process in processes:
                if process.poll() is not None:
                    raise RuntimeError(f"managed process exited with code {process.returncode}")
            time.sleep(0.5)
    except KeyboardInterrupt:
        stop()
    finally:
        stop()
        for process in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
        if not temporal_owned:
            print("Existing Temporal server was left running.")


if __name__ == "__main__":
    main()
