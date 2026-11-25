"""Positive synthetic HTTP journeys; no existing runtime or permission campaign."""
import http.cookiejar
import json
import tempfile
import threading
import unittest
import uuid
from pathlib import Path
from urllib.request import Request, build_opener, HTTPCookieProcessor
from http.server import ThreadingHTTPServer
from engine import Engine
from server import Handler
from simulation import seed_simulation


class LinceHTTP(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.engine = Engine(Path(cls.tmp.name) / 'lince.sqlite')
        cls.seed = seed_simulation(cls.engine)
        cls.mock = cls.engine.start_mock()
        class LocalHandler(Handler):
            engine = cls.engine
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), LocalHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = 'http://127.0.0.1:' + str(cls.server.server_port)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.mock.close()
        cls.tmp.cleanup()

    def client(self, username):
        account = next(x for x in self.seed['accounts'] if x['username'] == username)
        opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
        session = self.request(opener, '/api/login', {'username': username, 'password': account['password']})
        return opener, session

    def request(self, opener, path, data=None, csrf=None):
        headers = {}
        if data is not None:
            headers = {'Content-Type': 'application/json', 'Idempotency-Key': uuid.uuid4().hex}
        if csrf:
            headers['X-CSRF-Token'] = csrf
        req = Request(self.origin + path, data=None if data is None else json.dumps(data).encode(), headers=headers)
        with opener.open(req, timeout=25) as response:
            body = response.read()
            return json.loads(body) if 'application/json' in response.headers.get('Content-Type', '') else body

    def command(self, opener, session, name, payload):
        return self.request(opener, '/api/command', {'command': name, 'payload': payload}, session['csrf'])

    def test_desktop_driver_docs_and_installable_assets(self):
        opener = build_opener()
        self.assertIn('Lince', self.request(opener, '/').decode())
        self.assertIn('Lince', self.request(opener, '/driver/').decode())
        manifest = self.request(opener, '/driver/manifest.webmanifest')
        if isinstance(manifest, bytes):
            manifest = json.loads(manifest)
        self.assertEqual(manifest['scope'], '/driver/')
        for path in ['/driver/driver.js', '/driver/driver.css', '/driver/driver-sw.js', '/driver/icon.svg', '/driver/icon-192.png', '/driver/icon-512.png']:
            self.assertTrue(self.request(opener, path), path)
        docs = self.request(opener, '/docs/')
        self.assertIn(b'Lince', docs)
        self.assertTrue(self.request(opener, '/docs/openapi.json')['openapi'].startswith('3.1.'))

    def test_driver_pod_projects_same_shipment_in_desktop(self):
        driver, session = self.client('lince.motorista')
        data = self.request(driver, '/api/state')
        scenario = next(s for s in self.seed['manifest']['scenarios'] if s['id'] == 'DRIVER_READY_DELIVERY')
        trip = next(o for o in data['objects'] if o['id'] == scenario['shipmentId'])
        self.assertTrue(trip['stops'][0]['destination']['addressLine'])
        context = {'planVersion': trip['planVersion'], 'assignmentId': trip['assignmentId'], 'packageKeys': [p['key'] for p in trip['packages']]}
        payload = {'shipmentId': trip['id'], 'version': trip['version'], 'proofId': 'HTTP-DRIVER-' + uuid.uuid4().hex, 'packageKeys': context['packageKeys'], 'outcome': 'DELIVERED', 'reason': 'Recebido no teste HTTP fictício', 'occurredAt': self.engine.now().isoformat()}
        self.command(driver, session, 'offline_sync', {'command': 'pod', 'payload': payload, 'context': context})
        desktop, _ = self.client('loja.admin')
        actual = self.request(desktop, '/api/state?id=' + trip['id'])
        self.assertEqual(actual['status'], 'DELIVERED')
        self.assertEqual(len(actual['delivered']), len(trip['packages']))

    def test_simulation_catalog_unknown_and_fiscal_readiness(self):
        desktop, session = self.client('loja.admin')
        simulation = self.request(desktop, '/api/simulation')
        self.assertTrue(simulation['enabled'])
        self.assertEqual(len(simulation['manifest']['scenarios']), 18)
        scenario = next(x for x in simulation['manifest']['scenarios'] if x['id'] == 'ACTIVE_UNKNOWN')
        message = self.request(desktop, '/api/state?id=' + scenario['outboxId'])
        result = self.command(desktop, session, 'outbox_query', {'id': message['id'], 'version': message['version']})
        self.assertEqual(result['status'], 'DONE')
        scenario = next(x for x in simulation['manifest']['scenarios'] if x['id'] == 'FISCAL_PENDING')
        result = self.command(desktop, session, 'fiscal_readiness_assess', {'profileId': scenario['profileId']})
        self.assertEqual(result['status'], 'PENDING_DATA')
        self.assertFalse(result['realOperationAllowed'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
