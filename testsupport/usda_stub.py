"""Deterministic external-provider HTTP fixture; never part of the application image."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading


class Provider(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        record = {
            'fdcId': 424242,
            'description': 'E2E USDA Ingredient',
            'dataType': 'Foundation',
            'servingSize': 50,
            'servingSizeUnit': 'g',
            'householdServingFullText': 'medium',
            'foodNutrients': [
                {'nutrientId': key, 'value': value, 'unitName': unit}
                for key, value, unit in (
                    (1008, 100, 'kcal'),
                    (1003, 20, 'g'),
                    (1004, 5, 'g'),
                    (1005, 30, 'g'),
                    (1079, 10, 'g'),
                )
            ],
        }
        if '424243' in self.path or 'incomplete' in self.path:
            record['fdcId'] = 424243
            record['description'] = 'E2E Incomplete USDA'
            record['foodNutrients'] = [
                {'nutrientId': 1008, 'value': 100, 'unitName': 'kcal'},
                {'nutrientId': 1004, 'value': 0, 'unitName': 'g'},
            ]
        payload = {'foods': [record]} if '/foods/search' in self.path else record
        encoded = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def start_provider():
    server = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server
