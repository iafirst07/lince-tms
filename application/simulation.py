"""Opt-in Lince simulation dataset, built through real local domain commands.

Only a fresh, empty application database in a new runtime directory is accepted.
Passwords are random and returned to the caller, never placed in the manifest.
Every company, address, document and operation below is fictitious.
"""
from collections import Counter
from datetime import timedelta
from decimal import Decimal
import base64
import io
import json
import secrets
import time
import uuid
from core import canonical, require
from integrations import signature
from seed import seed

SIMULATION_VERSION = 'LINCE_SIMULATION_1'


def _empty_database(engine):
    with engine.db() as db:
        tables = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        for table in tables:
            if table == 'meta':
                require(not db.execute("SELECT 1 FROM meta WHERE k != 'schema'").fetchone(), 'SIMULATION_REQUIRES_EMPTY_DATABASE', 409)
            else:
                require(db.execute('SELECT count(*) FROM "' + table.replace('"', '""') + '"').fetchone()[0] == 0, 'SIMULATION_REQUIRES_EMPTY_DATABASE', 409)
    require(not (engine.path.parent / 'mock.sqlite').exists(), 'SIMULATION_REQUIRES_FRESH_DIRECTORY', 409)
    require(not getattr(engine, 'mock', None), 'SIMULATION_REQUIRES_FRESH_DIRECTORY', 409)


def seed_simulation(engine):
    """Create fresh local scenarios; never reset, merge or overwrite an existing DB.

    Return ``accounts`` privately to the initializer. The persistent manifest has
    usernames/roles and scenario IDs only, with no passwords or session tokens.
    A failed run may leave a partial new dataset: do not retry it blindly.
    """
    with engine.consistency.hold():
        _empty_database(engine)
        return _seed_new_database(engine)


def _seed_new_database(engine):
    base = engine.now().replace(microsecond=0)
    require(2026 <= base.year < 2030, 'SIMULATION_BASE_TARIFF_PERIOD', 409)
    fixture = seed(engine)
    shipper = fixture['shipper']
    carrier = fixture['carriers'][0]
    accounts = fixture['accounts']
    command_count = 0

    def call(actor, command, payload):
        nonlocal command_count
        command_count += 1
        return engine.execute(actor, command, payload, 'simulation-' + uuid.uuid4().hex)

    def read(actor, object_id):
        return engine.state(actor, object_id)

    def create_driver(username, label):
        password = secrets.token_urlsafe(24)
        user = call(carrier, 'user_create', {'username': username, 'password': password, 'roles': ['driver']})
        accounts.append({'username': username, 'password': password, 'org': carrier['org'], 'label': label})
        return user

    delivery_driver = create_driver('lince.motorista', 'Motorista de entregas — Lince')
    pickup_driver = create_driver('lince.coleta', 'Motorista de coleta — Lince')
    approver_account = next(a for a in accounts if a['username'] == 'loja.aprovador')
    approver = engine.login(approver_account['username'], approver_account['password'])['user']
    origin = call(shipper, 'master_create', {'kind': 'location', 'values': {
        'name': 'Centro pet sintético — Lince', 'postalCode': '01001000',
        'lat': -23.548, 'lon': -46.635, 'addressLine': 'Avenida das Rotas Sintéticas',
        'number': '100', 'district': 'Centro de Demonstração', 'city': 'São Paulo', 'uf': 'SP',
        'complement': 'Portaria de testes', 'deliveryInstructions': 'Endereço fictício: não realizar deslocamento real.'}})
    fiscal_policy = call(carrier, 'fiscal_policy', {'name': 'Lince — documento somente DEMO',
        'scenario': 'LINCE_SYNTHETIC_PET_ECOMMERCE', 'mode': 'DEMO_ONLY', 'requirements': ['DEMO_DOCUMENT']})
    tolerance = call(shipper, 'tolerance', {'name': 'Lince — conferência local', 'fixed': '0.50', 'percent': '0'})
    scenarios = []
    order_index = 0
    trip_index = 0
    mock = engine.start_mock()

    def process(actor, message):
        message = read(actor, message['id'])
        return call(actor, 'outbox_process', {'id': message['id'], 'version': message['version']})

    def order(external, slot=0, volumes=1, through_oms=False):
        nonlocal order_index
        order_index += 1
        packs = [{'id': 'V' + str(i + 1), 'weightKg': str(2 + i), 'lengthCm': '25',
                  'widthCm': '18', 'heightCm': '15', 'cargoClass': 'GENERAL'} for i in range(volumes)]
        quote = call(shipper, 'quote', {'originCep': '01001000', 'destinationCep': '01310100', 'packages': packs})
        location = call(shipper, 'master_create', {'kind': 'location', 'values': {
            'name': 'Destino pet sintético ' + str(order_index), 'postalCode': '01310100',
            'lat': -23.551 - order_index * .0004, 'lon': -46.641 - order_index * .0003,
            'addressLine': 'Rua dos Amigos Pet — Exemplo', 'number': str(10 + order_index),
            'district': 'Bairro de Demonstração', 'city': 'São Paulo', 'uf': 'SP',
            'complement': 'Unidade fictícia ' + str(order_index),
            'deliveryInstructions': 'Massa sintética. Conferir volumes no app; não entregar em endereço real.'}})
        start = base + timedelta(hours=slot)
        values = {'externalId': external, 'quoteId': quote['id'], 'candidate': 0, 'packages': packs,
                  'consumerCharge': '5.40', 'locationId': location['id'],
                  'windowStart': start.isoformat(), 'windowEnd': (start + timedelta(hours=3)).isoformat()}
        if through_oms:
            message = call(shipper, 'adapter_enqueue', {'adapter': 'OMS', 'payload': {'order': values}})
            result = process(shipper, message)
            return read(shipper, result['importedOrderId']), result
        return call(shipper, 'order_create', values), None

    def released(order_object):
        return call(shipper, 'order_release', {'id': order_object['id'], 'version': order_object['version']})

    def shipment(orders, slot):
        orders = [released(o) for o in orders]
        plan = call(shipper, 'plan', {'orderIds': [o['id'] for o in orders], 'originLocationId': origin['id'],
                                    'start': (base + timedelta(hours=slot)).isoformat(),
                                    'capacityKg': '100', 'speedKmh': '35'})
        require(plan['status'] == 'FEASIBLE', 'SIMULATION_PLAN_NOT_FEASIBLE')
        return call(shipper, 'plan_commit', {'id': plan['id'], 'version': plan['version']})

    def assign(ship, driver=delivery_driver):
        nonlocal trip_index
        trip_index += 1
        vehicle = call(carrier, 'fleet_create', {'type': 'VEHICLE', 'name': 'Van pet sintética ' + str(trip_index), 'capacityKg': '100'})
        resource = call(carrier, 'fleet_create', {'type': 'DRIVER', 'name': driver['username'] + ' — recurso ' + str(trip_index),
                                               'licenseValidTo': (base + timedelta(days=730)).isoformat(), 'userId': driver['id']})
        tender = call(shipper, 'tender', {'shipmentId': ship['id'], 'version': ship['version'],
                                       'carriers': [carrier['org']], 'expiresAt': (base + timedelta(days=1)).isoformat()})
        call(carrier, 'offer_respond', {'id': tender['id'], 'version': tender['version'], 'decision': 'ACCEPT',
                                       'vehicleId': vehicle['id'], 'driverId': resource['id']})
        return read(carrier, ship['id'])

    def stages(ship, until='DELIVERY'):
        label = call(carrier, 'label_request', {'shipmentId': ship['id'], 'version': ship['version']})
        process(carrier, label)
        ship = read(carrier, ship['id'])
        document = call(carrier, 'fiscal_evaluate', {'shipmentId': ship['id'], 'version': ship['version'],
                        'policyId': fiscal_policy['id'], 'scenario': fiscal_policy['scenario']})
        process(carrier, read(carrier, document['outboxId']))
        for stage in ['PICKUP', 'HUB', 'TRANSFER', 'LAST_MILE', 'DELIVERY']:
            ship = read(carrier, ship['id'])
            call(carrier, 'stage', {'shipmentId': ship['id'], 'version': ship['version'], 'stage': stage,
                                    'packageKeys': [x['key'] for x in ship['packages']]})
            if stage == until:
                break
        return read(carrier, ship['id'])

    def deliver(ship, proof_reference, partial=False):
        from PIL import Image, ImageDraw
        image = Image.new('RGB', (320, 140), '#eee5f8')
        ImageDraw.Draw(image).text((18, 35), 'LINCE - COMPROVANTE FICTICIO\nSEM ENTREGA REAL', fill='#4a246c')
        image_bytes = io.BytesIO(); image.save(image_bytes, format='PNG')
        uploaded = call(carrier, 'upload_pod', {'shipmentId': ship['id'],
            'base64': base64.b64encode(image_bytes.getvalue()).decode()})
        keys = [x['key'] for x in ship['packages']]
        proof = call(carrier, 'pod', {'shipmentId': ship['id'], 'version': ship['version'],
            'proofId': proof_reference, 'packageKeys': keys[:1] if partial else keys,
            'outcome': 'DELIVERED', 'reason': 'Comprovante fictício criado pelo simulador Lince',
            'fileId': uploaded['id'], 'occurredAt': base.isoformat()})
        return read(carrier, ship['id']), proof

    def record(scenario_id, title, expected, **references):
        scenarios.append({'id': scenario_id, 'title': title, 'expected': expected, **references})

    try:
        draft, _ = order('LINCE-PET-1001', 0, 2)
        record('DESKTOP_DRAFT', 'Pedido pet validado aguardando liberação', 'VALIDATED', orderId=draft['id'])
        unplanned, _ = order('LINCE-PET-1002', 0, 1)
        unplanned = released(unplanned)
        record('DESKTOP_RELEASED', 'Pedido pet liberado para planejar', 'RELEASED', orderId=unplanned['id'])

        first, _ = order('LINCE-PET-2001', 1, 2)
        second, _ = order('LINCE-PET-2002', 1, 1)
        driver_ready = stages(assign(shipment([first, second], 1)))
        record('DRIVER_READY_DELIVERY', 'Rota do motorista com duas paradas e três volumes', 'IN_TRANSIT/DELIVERY',
               shipmentId=driver_ready['id'], driverUsername=delivery_driver['username'],
               packageKeys=[x['key'] for x in driver_ready['packages']], nextAction='pod')
        wms = process(shipper, call(shipper, 'adapter_enqueue', {'adapter': 'WMS',
            'payload': {'shipmentId': driver_ready['id'], 'custody': 'READY'}}))
        record('PASSIVE_WMS', 'Custódia recebida pelo contrato WMS no mock HTTP', 'DONE',
               shipmentId=driver_ready['id'], outboxId=wms['id'])

        pickup_order, _ = order('LINCE-PET-3001', 5, 2)
        pickup = stages(assign(shipment([pickup_order], 5), pickup_driver), 'PICKUP')
        record('DRIVER_PICKUP', 'Coleta fictícia aguardando passagem pelo hub', 'IN_TRANSIT/PICKUP',
               shipmentId=pickup['id'], driverUsername=pickup_driver['username'], nextAction='stage:HUB')

        offered_order, _ = order('LINCE-PET-4001', 9, 1)
        offered = shipment([offered_order], 9)
        tender = call(shipper, 'tender', {'shipmentId': offered['id'], 'version': offered['version'],
            'carriers': [c['org'] for c in fixture['carriers']], 'expiresAt': (base + timedelta(days=1)).isoformat()})
        record('DESKTOP_TENDER', 'Oferta aberta a duas transportadoras sintéticas', 'OPEN',
               shipmentId=offered['id'], tenderId=tender['id'], nextAction='offer_respond')

        complete = []
        for index in range(3):
            values, _ = order('LINCE-PET-500' + str(index + 1), 13 + index * 4, 2 if index == 0 else 1)
            ship = stages(assign(shipment([values], 13 + index * 4)))
            ship, proof = deliver(ship, 'LINCE-POD-' + str(index + 1))
            expected_cost = Decimal(read(shipper, ship['assignmentId'])['price'])
            invoice = call(carrier, 'invoice_create', {'assignments': [ship['assignmentId']],
                'number': 'LINCE-FAT-' + str(index + 1), 'amount': str(expected_cost + (Decimal('15.00') if index == 0 else 0))})
            invoice = call(shipper, 'invoice_audit', {'id': invoice['id'], 'version': invoice['version'], 'toleranceId': tolerance['id']})
            complete.append((ship, proof, invoice))
            if index == 0:
                record('FINANCE_DISPUTE', 'Entrega concluída com divergência de frete de R$15', 'DISPUTED',
                       shipmentId=ship['id'], invoiceId=invoice['id'], disputeId=invoice['disputeId'])
            else:
                approval = call(shipper, 'approval_request', {'invoiceId': invoice['id'], 'version': invoice['version']})
                if index == 1:
                    record('FINANCE_APPROVAL', 'Fatura conferida aguardando aprovador', 'PENDING',
                           shipmentId=ship['id'], invoiceId=invoice['id'], approvalId=approval['id'], nextAction='approval_decide')
                else:
                    approval = call(approver, 'approval_decide', {'id': approval['id'], 'version': approval['version'], 'decision': 'APPROVE'})
                    payable = next(x for x in engine.state(shipper)['objects'] if x['id'] in approval['entryIds'] and x['side'] == 'AP')
                    erp = process(shipper, call(shipper, 'adapter_enqueue', {'adapter': 'ERP', 'payload': {'entryIds': [payable['id']], 'reference': 'LINCE-ERP-LOCAL'}}))
                    settlement = call(shipper, 'settlement_request', {'entryId': payable['id'], 'amount': '2.00', 'reason': 'Baixa parcial simulada'})
                    record('FINANCE_POSTED', 'AP/AR locais e ERP mock conciliado, baixa parcial para aprovar', 'POSTED_LOCAL',
                           shipmentId=ship['id'], invoiceId=invoice['id'], approvalId=approval['id'],
                           settlementApprovalId=settlement['id'], erpOutboxId=erp['id'])

        reverse_ship = complete[0][0]
        return_object = call(shipper, 'return_create', {'shipmentId': reverse_ship['id'],
            'packageKeys': [reverse_ship['packages'][0]['key']], 'reason': 'Retorno fictício de embalagem pet'})
        claim = call(carrier, 'claim_create', {'shipmentId': reverse_ship['id'], 'type': 'DAMAGE',
            'packageKeys': [reverse_ship['packages'][0]['key']], 'description': 'Embalagem sintética avariada para exercitar tratamento'})
        record('REVERSE_AND_CLAIM', 'Reversa parcial autorizada e ocorrência aberta', 'AUTHORIZED/OPEN',
               shipmentId=reverse_ship['id'], returnId=return_object['id'], claimId=claim['id'])

        partial_order, _ = order('LINCE-PET-6001', 25, 2)
        partial = stages(assign(shipment([partial_order], 25)))
        partial, partial_proof = deliver(partial, 'LINCE-POD-PARCIAL', True)
        record('DRIVER_PARTIAL', 'Entrega parcial com um volume restante', 'PARTIAL',
               shipmentId=partial['id'], driverUsername=delivery_driver['username'], proofId=partial_proof['id'], nextAction='pod')

        passive_order, inbound = order('LINCE-PET-OMS-7001', 29, 1, True)
        record('PASSIVE_OMS', 'Pedido recebido por contrato OMS no mock HTTP', 'VALIDATED',
               orderId=passive_order['id'], outboxId=inbound['id'], transport='LOCAL_HTTP_MOCK')
        callback = {'event': 'LINCE_DEMO_STATUS_AVAILABLE', 'orderReference': passive_order['externalId'], 'real': False}
        ts = int(time.time()); body = canonical({'source': 'OMS', 'message': 'LINCE-PASSIVE-001', 'payload': callback}).encode()
        inbox = engine.receive_callback('OMS', 'LINCE-PASSIVE-001', callback, ts, signature(mock.key, ts, body))
        record('PASSIVE_INBOX', 'Recebimento local assinado registrado, sem inventar atualização de domínio', inbox['status'],
               messageReference='LINCE-PASSIVE-001', domainProjectionApplied=False)

        coordinates = [{'lat': -23.548, 'lon': -46.635}, {'lat': -23.555, 'lon': -46.645}]
        unknown = process(shipper, call(shipper, 'adapter_enqueue', {'adapter': 'MAPS', 'mode': 'LOST_RESPONSE', 'payload': {'locations': coordinates}}))
        record('ACTIVE_UNKNOWN', 'Resposta perdida: consultar antes de tentar novamente', 'UNKNOWN',
               outboxId=unknown['id'], nextAction='outbox_query', transport='LOCAL_HTTP_MOCK')
        resolved = process(shipper, call(shipper, 'adapter_enqueue', {'adapter': 'MAPS', 'mode': 'LOST_RESPONSE', 'payload': {'locations': coordinates}}))
        resolved = call(shipper, 'outbox_query', {'id': resolved['id'], 'version': resolved['version']})
        record('ACTIVE_RECONCILED', 'Consulta reconciliou um único protocolo local', 'DONE', outboxId=resolved['id'])
        dead = call(shipper, 'adapter_enqueue', {'adapter': 'MAPS', 'mode': 'BEFORE_FAILURE', 'payload': {'locations': coordinates}})
        for _ in range(3):
            dead = process(shipper, dead)
        record('ACTIVE_DLQ', 'Três falhas comprovadas sem efeito; triagem manual', 'DLQ', outboxId=dead['id'], nextAction='outbox_requeue')

        if hasattr(engine, 'cmd_fiscal_profile_create'):
            profile = call(shipper, 'fiscal_profile_create', {'name': 'Lince — contrato fiscal local',
                'issuerRef': 'issuer:lince-synthetic', 'ufs': ['SP'], 'documents': ['CTE', 'MDFE'],
                'route': 'LOCAL_MOCK', 'environment': 'LOCAL_TEST',
                'scenarioApprovalRef': 'review:lince-synthetic-scenario',
                'schemaRefs': {'CTE': 'schema:cte-candidate', 'MDFE': 'schema:mdfe-candidate'}})
            assessment = call(shipper, 'fiscal_readiness_assess', {'profileId': profile['id']})
            preflight = call(shipper, 'fiscal_local_preflight', {'profileId': profile['id'], 'document': 'CTE',
                'operation': 'ISSUE', 'businessReference': 'LINCE-PET-2001', 'requestReference': 'LINCE-PREFLIGHT-LOCAL'})
            record('FISCAL_LOCAL', 'Perfil e envelope fiscal explicitamente simulados', 'DEMO_PREPARED',
                   profileId=profile['id'], assessmentId=assessment['id'], preflightId=preflight['id'])
            pending = call(shipper, 'fiscal_profile_create', {'name': 'Lince — integração futura',
                'route': 'DIRECT', 'environment': 'HOMOLOGATION'})
            pending_assessment = call(shipper, 'fiscal_readiness_assess', {'profileId': pending['id']})
            record('FISCAL_PENDING', 'Perfil externo incompleto sem certificado nem emissão real', 'PENDING_DATA',
                   profileId=pending['id'], assessmentId=pending_assessment['id'])

        # Only the manifest is fixture metadata; all operational state above used commands.
        with engine.db(True) as db:
            counts = dict(sorted(Counter(x['kind'] for x in engine.all(db)).items()))
            role_map = {row['username']: json.loads(row['roles']) for row in db.execute('SELECT username,roles FROM users')}
            for account in accounts:
                account['roles'] = role_map[account['username']]
            manifest = engine.add(db, shipper, 'simulationManifest', {
                'name': 'Lince — laboratório de e-commerce pet', 'simulationVersion': SIMULATION_VERSION,
                'status': 'READY_LOCAL_SIMULATION', 'baseClock': base.isoformat(),
                'scenarios': scenarios, 'objectCountsBeforeManifest': counts,
                'domainCommandCountAfterBaseSeed': command_count,
                'entryPoints': {'desktop': '/', 'driver': '/driver/'},
                'accounts': [{'username': a['username'], 'org': a['org'], 'roles': a['roles'], 'label': a.get('label', a['username'])} for a in accounts],
                'dataClassification': 'FICTITIOUS_PET_ECOMMERCE_ONLY', 'realOperationAllowed': False,
                'externalConnections': False, 'recurringAutomationCreated': False,
                'limitations': ['Estados ilustrativos criados agora, não cronologia de uma operação real.',
                    'Datas relativas ao relógio da instância; promessas e janelas sintéticas.',
                    'IDs e credenciais são aleatórios; o desenho dos cenários é determinístico.',
                    'Inbox acusa recebimento local; não projeta automaticamente eventos de fornecedor.',
                    'Somente mocks HTTP locais; nenhuma integração corporativa ou governamental.']})
            require(db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok', 'SIMULATION_INTEGRITY')
        return {'mode': 'EXPLICIT_SIMULATION', 'accounts': accounts, 'manifest': dict(manifest),
                'shipper': shipper, 'carriers': fixture['carriers'],
                'driver': {'id': delivery_driver['id'], 'org': carrier['org'], 'username': delivery_driver['username'], 'roles': ['driver']},
                'pickupDriver': {'id': pickup_driver['id'], 'org': carrier['org'], 'username': pickup_driver['username'], 'roles': ['driver']}}
    finally:
        mock.close()
        engine.mock = None
