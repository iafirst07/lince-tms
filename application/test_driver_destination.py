import unittest
from test_a import Base,PACKS

class DriverDestination(Base):
    def test_destination_snapshot_survives_master_change_and_route(self):
        vals={'name':'Destino fictício','postalCode':'01310100','lat':-23.55,'lon':-46.65,'addressLine':'Rua de Teste','number':'123','city':'São Paulo','uf':'SP','deliveryInstructions':'Portaria fictícia'}
        loc=self.cmd('master_create',{'kind':'location','values':vals})
        quote=self.quote()
        order=self.cmd('order_create',{'externalId':'APP-DRIVER-1','quoteId':quote['id'],'candidate':0,'packages':PACKS,'consumerCharge':'5','locationId':loc['id'],'windowStart':'2026-11-25T16:00:00Z','windowEnd':'2026-11-25T22:00:00Z'})
        self.cmd('master_update',{'id':loc['id'],'version':loc['version'],'values':dict(vals,addressLine='Rua alterada',lat=-23.9)})
        self.cmd('order_release',{'id':order['id'],'version':order['version']})
        origin=self.cmd('master_create',{'kind':'location','values':{'name':'Origem','postalCode':'01001000','lat':-23.54,'lon':-46.64}})
        plan=self.cmd('plan',{'orderIds':[order['id']],'originLocationId':origin['id'],'start':'2026-11-25T16:00:00Z','capacityKg':'100','speedKmh':'40'})
        shipment=self.cmd('plan_commit',{'id':plan['id'],'version':plan['version']})
        stop=shipment['stops'][0]
        self.assertEqual(stop['destination']['addressLine'],'Rua de Teste')
        self.assertEqual(stop['destination']['lat'],-23.55)
        self.assertEqual(stop['orderReference'],'APP-DRIVER-1')
        self.assertEqual(stop['windowEnd'],'2026-11-25T22:00:00Z')
        self.assertNotIn('org',stop['destination'])
        self.assertNotIn('createdBy',stop['destination'])
    def test_address_fields_are_optional_and_validated(self):
        vals={'name':'Local','postalCode':'01310100','lat':-23.55,'lon':-46.65}
        self.cmd('master_create',{'kind':'location','values':vals})
        self.error('INVALID_UF',lambda:self.cmd('master_create',{'kind':'location','values':dict(vals,uf='XX')}))
        self.error('INVALID_DELIVERY_ADDRESS',lambda:self.cmd('master_create',{'kind':'location','values':dict(vals,addressLine=['invalid'])}))

if __name__=='__main__':unittest.main(verbosity=2)
