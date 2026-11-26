"""Fictional dock appointments; offset instants, no physical yard or sensor."""
import re
from copy import deepcopy
from datetime import timezone
from core import action, require, ident, moment

ACTIVE = {'RESERVED', 'CHECKED_IN'}

def integer(value, minimum, maximum, code):
    require(type(value) is int and minimum <= value <= maximum, code)
    return value

def interval(start, end):
    pattern = r'[1-9]\d{3}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)'
    require(all(isinstance(x, str) and re.fullmatch(pattern, x) for x in [start, end]), 'TIMEZONE_REQUIRED')
    a, b = moment(start), moment(end)
    require(a.utcoffset() is not None and b.utcoffset() is not None, 'TIMEZONE_REQUIRED')
    require(a < b, 'INVALID_DOCK_INTERVAL')
    return a.astimezone(timezone.utc).isoformat(), b.astimezone(timezone.utc).isoformat()

def calc_overlap_capacity(reservations, start, end, units, exclude_id=None):
    a, b = moment(start), moment(end)
    events = [(a, units), (b, -units)]
    for row in reservations:
        if row.get('id') == exclude_id or row.get('status') not in ACTIVE:
            continue
        x, y = max(a, moment(row['start'])), min(b, moment(row['end']))
        if x < y:
            events.extend([(x, row['units']), (y, -row['units'])])
    current = peak = 0
    for _, delta in sorted(events, key=lambda event: (event[0], event[1])):
        current += delta
        peak = max(peak, current)
    return peak

class Dock:
    @action('admin', 'planner', 'operator')
    def cmd_dock_create(self, db, p, d):
        location = self.get(db, p, d.get('locationId'), 'location', True)
        name, zone = ident(d.get('name')), ident(d.get('timezone'))
        require(name.strip() and zone.strip(), 'INVALID_DOCK_TEXT')
        capacity = integer(d.get('capacity'), 1, 20, 'INVALID_DOCK_CAPACITY')
        return self.add(db, p, 'dock', {'locationId': location['id'], 'locationSnapshot': deepcopy(dict(location)), 'name': name,
            'capacity': capacity, 'timezone': zone, 'timezoneRole': 'METADATA_ONLY_OFFSET_IS_AUTHORITATIVE', 'simulation': True})

    def dock_capacity(self, db, dock, start, end, units, exclude_id=None):
        rows = [r for r in self.all(db, 'dockReservation') if r['dockId'] == dock['id']]
        require(calc_overlap_capacity(rows, start, end, units, exclude_id) <= dock['capacity'], 'DOCK_CAPACITY_CONFLICT', 409)

    @action('admin', 'planner', 'operator')
    def cmd_dock_reserve(self, db, p, d):
        dock = self.get(db, p, d.get('dockId'), 'dock', True)
        start, end = interval(d.get('start'), d.get('end'))
        units = integer(d.get('units'), 1, dock['capacity'], 'INVALID_DOCK_UNITS')
        reference = ident(d.get('reference'))
        require(reference.strip(), 'INVALID_DOCK_TEXT')
        shipment = self.get(db, p, d['shipmentId'], 'shipment', True) if d.get('shipmentId') is not None else None
        self.dock_capacity(db, dock, start, end, units)
        return self.add(db, p, 'dockReservation', {'dockId': dock['id'], 'dockSnapshot': deepcopy(dict(dock)),
            'locationSnapshot': deepcopy(dock['locationSnapshot']), 'shipmentId': shipment['id'] if shipment else None,
            'reference': reference, 'start': start, 'end': end, 'units': units, 'status': 'RESERVED', 'simulation': True,
            'history': [{'status': 'RESERVED', 'start': start, 'end': end, 'at': self.now().isoformat(), 'actor': p['id']}]})

    @action('admin', 'planner', 'operator')
    def cmd_dock_reschedule(self, db, p, d):
        row = self.get(db, p, d.get('id'), 'dockReservation', True)
        require(type(d.get('version')) is int, 'VERSION_CONFLICT', 409)
        self.version(row, d)
        require(row['status'] == 'RESERVED', 'DOCK_RESCHEDULE_BLOCKED', 409)
        reason = ident(d.get('reason')); require(reason.strip(), 'INVALID_DOCK_TEXT')
        start, end = interval(d.get('start'), d.get('end'))
        dock = self.get(db, p, row['dockId'], 'dock', True)
        self.dock_capacity(db, dock, start, end, row['units'], row['id'])
        row['history'].append({'status': 'RESCHEDULED', 'previousStart': row['start'], 'previousEnd': row['end'],
            'start': start, 'end': end, 'reason': reason, 'actor': p['id'], 'at': self.now().isoformat()})
        row.update(start=start, end=end)
        return self.save(db, row)

    @action('admin', 'planner', 'operator')
    def cmd_dock_progress(self, db, p, d):
        row = self.get(db, p, d.get('id'), 'dockReservation', True)
        require(type(d.get('version')) is int, 'VERSION_CONFLICT', 409)
        self.version(row, d)
        status, reason = d.get('status'), ident(d.get('reason'))
        require(reason.strip(), 'INVALID_DOCK_TEXT')
        allowed = {'RESERVED': {'CHECKED_IN', 'CANCELLED', 'NO_SHOW'}, 'CHECKED_IN': {'CHECKED_OUT'}}
        require(isinstance(status, str) and status in allowed.get(row['status'], set()), 'INVALID_DOCK_TRANSITION', 409)
        if status == 'NO_SHOW': require(self.now() >= moment(row['end']), 'DOCK_NO_SHOW_TOO_EARLY', 409)
        row['history'].append({'status': status, 'previousStatus': row['status'], 'reason': reason, 'actor': p['id'], 'at': self.now().isoformat()})
        row['status'] = status
        return self.save(db, row)
