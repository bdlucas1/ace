import http.server
import socketserver

PORT = 8002
IP = "0.0.0.0"

class NoCacheHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_no_cache_headers()
        super().end_headers()

    def send_no_cache_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')

with socketserver.TCPServer((IP, PORT), NoCacheHTTPRequestHandler) as httpd:
    print(f"Serving at http://localhost:{PORT}")
    httpd.serve_forever()
