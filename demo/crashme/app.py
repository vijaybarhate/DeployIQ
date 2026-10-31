"""Deliberately breakable demo service (stdlib only).

Routes:
  /         -> 200 "ok"                     (normal startup check)
  /health   -> 200 unless /tmp/unhealthy exists (health-check failure scenario)
  /boom     -> logs a traceback to stderr, returns HTTP 500 (app error, container lives)
  /die      -> abrupt process exit(1)     (unexpected crash scenario)
"""

import os
import sys
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(os.environ.get("PORT", "8000"))
UNHEALTHY_FLAG = "/tmp/unhealthy"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # route access log to stderr for `docker logs`
        sys.stderr.write("access: " + fmt % args + "\n")

    def _send(self, code: int, body: bytes) -> None:
        self.send_response(code)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/boom":
            try:
                1 / 0
            except ZeroDivisionError:
                traceback.print_exc()  # captured by `docker logs` -> evidence
            self._send(500, b"boom: ZeroDivisionError\n")
        elif self.path == "/die":
            self._send(200, b"dying\n")
            sys.stderr.flush()
            os._exit(1)
        elif self.path == "/health":
            if os.path.exists(UNHEALTHY_FLAG):
                self._send(500, b"unhealthy\n")
            else:
                self._send(200, b"healthy\n")
        else:
            self._send(200, b"ok\n")


if __name__ == "__main__":
    sys.stderr.write("crashme listening\n")
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
