"""Targeted editable fleet delta; synthetic DBs and ordinary domain validation only."""
import tempfile
import unittest
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from core import Error
from engine import Engine
from resource_edit import ResourceEdit
from seed import seed
from test_tms_journey import TmsJourneyTests, EVENTS


if issubclass(Engine, ResourceEdit):
    EditableEngine = Engine
else:
    class EditableEngine(ResourceEdit, Engine):
        pass


class ResourceEditTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.now = datetime.fromisoformat('2026-11-25T16:00:00+00:00')
        self.e = EditableEngine(Path(self.tmp.name) / 'fleet.sqlite', lambda: self.now)
        self.fixture = seed(self.e)
        self.p = self.fixture['shipper']; self.c = self.fixture['carriers'][0]
        self.vehicle = self.cmd('fleet_create', {'type':'VEHICLE','name':'Van ficticia','capacityKg':'100','fleetMode':'OWN'})
        self.driver = self.cmd('fleet_create', {'type':'DRIVER','name':'Motorista ficticio','licenseValidTo':'2030-01-01T00:00:00Z'})
    def tearDown(self):
        self.tmp.cleanup()
    def cmd(self, name, data, actor=None):
        return self.e.execute(actor or self.c, name, data, uuid.uuid4().hex)
    def update(self, resource, values):
        return self.cmd('fleet_update', {'id':resource['id'],'version':resource['version'],'values':values})
    def test_vehicle_and_driver_edit_preserve_other_fields_and_persist(self):
        for original, values in [(self.vehicle, {'name':'Van Lince','capacityKg':'120'}),
                                 (self.driver, {'name':'Motorista Lince','licenseValidTo':'2031-01-01T00:00:00Z'})]:
            changed = self.update(original, values)
            expected = dict(original, **values, version=original['version']+1)
            self.assertEqual(changed, expected)
            reopened = EditableEngine(self.e.path, lambda:self.now) if hasattr(self.e,'path') else self.e
            self.assertEqual(reopened.state(self.c, changed['id']), expected)
        current = self.e.state(self.c, self.vehicle['id'])
        renamed = self.update(current, {'name':'Apenas nome'})
        self.assertEqual(renamed['capacityKg'],'120')
    def test_stale_and_incompatible_or_invalid_values_leave_resource_unchanged(self):
        current = self.update(self.vehicle, {'name':'Nova van'})
        with self.assertRaisesRegex(Error,'VERSION_CONFLICT'): self.update(self.vehicle, {'name':'Versao antiga'})
        for values in [{}, [], {'licenseValidTo':'2030-01-01T00:00:00Z'}, {'capacityKg':'0'}, {'name':''}]:
            with self.subTest(values=values), self.assertRaises(Error): self.update(current, values)
            self.assertEqual(self.e.state(self.c,current['id']),current)
        for values in [{'capacityKg':'100'}, {'licenseValidTo':'sem-data'}]:
            with self.subTest(values=values), self.assertRaises(Error): self.update(self.driver, values)
    def test_scheduled_maintenance_blocks_until_cancelled(self):
        maintenance = self.cmd('maintenance', {'resourceId':self.vehicle['id'],'start':self.now.isoformat(),
            'end':(self.now+timedelta(hours=1)).isoformat(),'reason':'Inspecao ficticia'})
        with self.assertRaisesRegex(Error,'RESOURCE_MAINTENANCE'): self.update(self.vehicle, {'name':'Bloqueada'})
        self.cmd('maintenance_finish', {'id':maintenance['id'],'version':maintenance['version'],'result':'CANCELLED','reason':'Reagendamento sintetico'})
        self.assertEqual(self.update(self.vehicle, {'name':'Livre'})['name'],'Livre')
    def test_active_reservation_blocks_both_resources_then_release_allows_edit(self):
        # Reuse only setup helpers, never load another TestCase suite.
        journey = TmsJourneyTests('test_PY03_cancel_after_award_requires_resolution_and_frees_resources')
        journey.e=self.e;journey.now=self.now;journey.p=self.p;journey.c=self.c;journey.case='resource_reservation';EVENTS[journey.case]={'commands':[],'observed':[]}
        journey.origin=journey.cmd('master_create',{'kind':'location','values':{'name':'Origem ficticia','postalCode':'01001000','lat':-23.54,'lon':-46.64}})
        order=journey.release(journey.order('FLEET-RESERVATION'))
        ship,_=journey.award(journey.commit(journey.plan([order])),(self.vehicle,self.driver))
        for resource in [self.vehicle,self.driver]:
            with self.assertRaisesRegex(Error,'RESOURCE_RESERVED'):self.update(resource,{'name':'Recurso ocupado'})
            self.assertEqual(self.e.state(self.c,resource['id']),resource)
        current=journey.read(order['id'])
        proposal=journey.cmd('order_change',{'id':current['id'],'version':current['version'],'operation':'CANCEL','reason':'Teste liberação'})
        journey.cmd('change_resolve',{'id':proposal['id'],'version':proposal['version']})
        self.assertEqual(self.update(self.vehicle,{'capacityKg':'150'})['capacityKg'],'150')
        self.assertEqual(self.update(self.driver,{'name':'Livre novamente'})['name'],'Livre novamente')

if __name__=='__main__':unittest.main(verbosity=2)
