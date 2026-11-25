"""Positive local scenario tests. Does not exercise the blocked permission campaign."""
from datetime import datetime, timezone
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
import uuid
from core import Error
from engine import Engine
from simulation import seed_simulation, SIMULATION_VERSION


class SimulationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'lince.sqlite'
        self.clock = lambda: datetime(2026, 11, 25, 18, 0, tzinfo=timezone.utc)
        self.engine = Engine(self.path, self.clock)
        self.result = seed_simulation(self.engine)
        self.shipper = self.result['shipper']
        self.scenarios = {x['id']: x for x in self.result['manifest']['scenarios']}

    def tearDown(self):
        if getattr(self.engine, 'mock', None):
            self.engine.mock.close(); self.engine.mock = None
        self.temp.cleanup()

    def call(self, actor, command, data):
        return self.engine.execute(actor, command, data, uuid.uuid4().hex)

    def test_desktop_scenarios_and_delivery_addresses(self):
        self.assertEqual(self.result['mode'], 'EXPLICIT_SIMULATION')
        self.assertEqual(self.result['manifest']['simulationVersion'], SIMULATION_VERSION)
        self.assertEqual(len(self.scenarios), 18)
        state = self.engine.state(self.shipper)
        objects = {x['id']: x for x in state['objects']}
        for sid, field, status in [('DESKTOP_DRAFT', 'orderId', 'VALIDATED'), ('DESKTOP_RELEASED', 'orderId', 'RELEASED'),
                                   ('DESKTOP_TENDER', 'tenderId', 'OPEN'), ('FINANCE_DISPUTE', 'invoiceId', 'DISPUTED'),
                                   ('FINANCE_APPROVAL', 'approvalId', 'PENDING'), ('FINANCE_POSTED', 'invoiceId', 'POSTED_LOCAL'),
                                   ('ACTIVE_UNKNOWN', 'outboxId', 'UNKNOWN'), ('ACTIVE_RECONCILED', 'outboxId', 'DONE'),
                                   ('ACTIVE_DLQ', 'outboxId', 'DLQ')]:
            with self.subTest(scenario=sid):
                self.assertEqual(objects[self.scenarios[sid][field]]['status'], status)
        ship = objects[self.scenarios['DRIVER_READY_DELIVERY']['shipmentId']]
        self.assertEqual(len(ship['packages']), 3); self.assertEqual(len(ship['stops']), 2)
        self.assertEqual((ship['status'], ship['stage']), ('IN_TRANSIT', 'DELIVERY'))
        for stop in ship['stops']:
            self.assertTrue({'addressLine', 'number', 'district', 'city', 'uf', 'deliveryInstructions'} <= stop['destination'].keys())
            self.assertIn('sintética', stop['destination']['deliveryInstructions'].lower())
        self.assertEqual(objects[self.scenarios['REVERSE_AND_CLAIM']['returnId']]['status'], 'AUTHORIZED')
        self.assertEqual(objects[self.scenarios['REVERSE_AND_CLAIM']['claimId']]['status'], 'OPEN')
        self.assertFalse(self.result['manifest']['realOperationAllowed'])

    def test_dedicated_driver_can_complete_delivery_and_replay_offline_positive(self):
        driver = self.result['driver']; self.assertEqual(driver['roles'], ['driver'])
        state = self.engine.state(driver)
        ship = next(x for x in state['objects'] if x['id'] == self.scenarios['DRIVER_READY_DELIVERY']['shipmentId'])
        self.assertEqual(ship['driverUserId'], driver['id'])
        self.assertEqual(ship['stops'][0]['destination']['uf'], 'SP')
        context = {'assignmentId': ship['assignmentId'], 'planVersion': ship['planVersion'], 'packageKeys': [x['key'] for x in ship['packages']]}
        first = {'shipmentId': ship['id'], 'version': ship['version'], 'proofId': 'SIM-DRIVER-FIRST',
                 'packageKeys': [ship['packages'][0]['key']], 'outcome': 'DELIVERED',
                 'reason': 'Teste funcional sintético', 'occurredAt': self.clock().isoformat()}
        self.call(driver, 'pod', first)
        partial = self.engine.state(driver, ship['id']); self.assertEqual(partial['status'], 'PARTIAL')
        second = {**first, 'proofId': 'SIM-DRIVER-REMAINING', 'packageKeys': [x['key'] for x in ship['packages'][1:]]}
        request = {'command': 'pod', 'payload': second, 'context': context}
        proof = self.call(driver, 'offline_sync', request)
        replay = self.call(driver, 'offline_sync', request)
        self.assertEqual(replay['id'], proof['id'])
        finished = self.engine.state(driver, ship['id'])
        self.assertEqual(finished['status'], 'DELIVERED'); self.assertEqual(len(finished['delivered']), 3)

    def test_mock_active_passive_reconciliation_and_dlq(self):
        carrier = self.result['carriers'][0]
        inbound = self.engine.state(self.shipper, self.scenarios['PASSIVE_OMS']['orderId'])
        self.assertEqual(inbound['externalId'], 'LINCE-PET-OMS-7001')
        ship = self.engine.state(carrier, self.scenarios['PASSIVE_WMS']['shipmentId'])
        self.assertEqual(ship['wmsCustody'], 'READY')
        with self.engine.db() as db:
            inbox = db.execute('SELECT * FROM inbox WHERE message=?', ('LINCE-PASSIVE-001',)).fetchall()
        self.assertEqual(len(inbox), 1)
        self.engine.start_mock()
        pending = self.engine.state(self.shipper, self.scenarios['ACTIVE_UNKNOWN']['outboxId'])
        resolved = self.call(self.shipper, 'outbox_query', {'id': pending['id'], 'version': pending['version']})
        self.assertEqual(resolved['status'], 'DONE')
        with closing(sqlite3.connect(self.engine.mock.path)) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM accepted WHERE id=?', (pending['messageId'],)).fetchone()[0], 1)
        dead = self.engine.state(self.shipper, self.scenarios['ACTIVE_DLQ']['outboxId'])
        queued = self.call(self.shipper, 'outbox_requeue', {'id': dead['id'], 'version': dead['version'], 'reason': 'Triagem sintética sem efeito anterior', 'mode': 'GOOD'})
        done = self.call(self.shipper, 'outbox_process', {'id': queued['id'], 'version': queued['version']})
        self.assertEqual(done['status'], 'DONE'); self.assertEqual(done['attempts'], 4)

    def test_manifest_reopen_integrity_no_credentials_and_empty_database_guard(self):
        manifest = self.result['manifest']
        text = json.dumps(manifest)
        self.assertNotIn('password', text); self.assertNotIn('csrf', text)
        for account in self.result['accounts']:
            self.assertNotIn(account['password'], text)
        reopened = Engine(self.path, self.clock)
        self.assertEqual(reopened.state(self.shipper, manifest['id']), manifest)
        before = self.engine.state(self.shipper)
        with self.assertRaisesRegex(Error, 'SIMULATION_REQUIRES_EMPTY_DATABASE'):
            seed_simulation(self.engine)
        self.assertEqual(self.engine.state(self.shipper), before)
        with self.engine.db() as db:
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            self.assertGreaterEqual(db.execute('SELECT count(*) FROM files').fetchone()[0], 4)

    def test_financial_approval_and_reverse_can_continue_from_fixture(self):
        access = next(x for x in self.result['accounts'] if x['username'] == 'loja.aprovador')
        approver = self.engine.login(access['username'], access['password'])['user']
        scenario = self.scenarios['FINANCE_APPROVAL']
        approval = self.engine.state(self.shipper, scenario['approvalId'])
        self.call(approver, 'approval_decide', {'id': approval['id'], 'version': approval['version'], 'decision': 'APPROVE'})
        self.assertEqual(self.engine.state(self.shipper, scenario['invoiceId'])['status'], 'POSTED_LOCAL')
        reverse = self.engine.state(self.shipper, self.scenarios['REVERSE_AND_CLAIM']['returnId'])
        carrier = self.result['carriers'][0]
        collected = self.call(carrier, 'return_progress', {'id': reverse['id'], 'version': reverse['version'], 'status': 'COLLECTED'})
        received = self.call(self.shipper, 'return_progress', {'id': collected['id'], 'version': collected['version'], 'status': 'RECEIVED'})
        closed = self.call(self.shipper, 'return_progress', {'id': received['id'], 'version': received['version'], 'status': 'CLOSED'})
        self.assertEqual(closed['status'], 'CLOSED')
        local = self.engine.state(self.shipper, self.scenarios['FISCAL_LOCAL']['preflightId'])
        pending = self.engine.state(self.shipper, self.scenarios['FISCAL_PENDING']['assessmentId'])
        self.assertEqual(local['status'], 'DEMO_PREPARED'); self.assertFalse(local['productionReady'])
        self.assertEqual(pending['status'], 'PENDING_DATA'); self.assertTrue(pending['missing'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
