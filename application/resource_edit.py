"""Editable fleet metadata; existing reservations and maintenance remain authoritative."""
from decimal import Decimal
from core import action, require, ident, dec, moment


class ResourceEdit:
    @action('admin', 'planner')
    def cmd_fleet_update(self, db, p, d):
        resource = self.get(db, p, d.get('id'), 'resource', True)
        self.version(resource, d)
        values = d.get('values')
        require(isinstance(values, dict) and bool(values), 'INVALID_RESOURCE_VALUES')
        status_update='status' in values
        allowed = {'status'} if status_update else ({'name', 'capacityKg'} if resource['type'] == 'VEHICLE' else {'name', 'licenseValidTo'})
        require(set(values) <= allowed, 'INVALID_RESOURCE_FIELD')
        if 'name' in values:
            ident(values['name'])
        if 'capacityKg' in values:
            dec(values['capacityKg'], Decimal('.001'))
        if 'licenseValidTo' in values:
            moment(values['licenseValidTo'])
        require(not any(x['status'] == 'ACTIVE' and resource['id'] in x['resourceIds']
                        for x in self.all(db, 'reservation')), 'RESOURCE_RESERVED', 409)
        require(not any(x['status'] == 'SCHEDULED' and x['resourceId'] == resource['id']
                        for x in self.all(db, 'maintenance')), 'RESOURCE_MAINTENANCE', 409)
        if status_update:return self.save(db,self.catalog_status(resource,p,d))
        resource.update(values)
        return self.save(db, resource)
