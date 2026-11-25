"""Functional contract tests only; temporary SQLite, no network or certificates."""
import copy
import json
from pathlib import Path
import secrets
import tempfile
import unittest
from datetime import datetime, timezone
from engine import Engine
from fiscal_readiness import FiscalReadiness, FiscalAdapterPort
from core import Error

FiscalEngine = Engine if issubclass(Engine, FiscalReadiness) else type('FiscalEngine', (FiscalReadiness, Engine), {})


class FiscalReadinessTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'fiscal.sqlite'
        self.now = lambda: datetime(2026, 11, 25, 18, 0, tzinfo=timezone.utc)
        self.engine = FiscalEngine(self.path, self.now)
        self.user = self.engine.bootstrap('Organização sintética fiscal', 'fiscal.synthetic', secrets.token_urlsafe(24))
        self.seq = 0

    def tearDown(self):
        self.tmp.cleanup()

    def cmd(self, name, values, key=None):
        self.seq += 1
        return self.engine.execute(self.user, name, values, key or 'fiscal-case-' + str(self.seq))

    def profile(self, route='LOCAL_MOCK', environment='LOCAL_TEST'):
        data = {'name': 'Perfil sintético', 'issuerRef': 'issuer:synthetic', 'ufs': ['SP'],
                'documents': ['CTE', 'MDFE', 'CIOT', 'NFE_REFERENCE'], 'route': route,
                'environment': environment, 'scenarioApprovalRef': 'review:scenario-synthetic',
                'schemaRefs': {'CTE': 'schema:cte-4.00', 'MDFE': 'schema:mdfe-3.00b',
                               'CIOT': 'contract:ciot-to-confirm', 'NFE_REFERENCE': 'contract:oms-reference'}}
        if route != 'LOCAL_MOCK':
            data.update(certificateRef='vault:certificate-reference-only', registrationRef='record:registration-declared',
                        endpointCatalogRef='catalog:environment-declared', retentionPolicyRef='policy:retention')
        if route == 'PROVIDER':
            data.update(providerRef='provider:not-selected', contractRef='contract:candidate')
        return data

    def test_missing_data_never_means_exemption_or_release(self):
        profile = self.cmd('fiscal_profile_create', {'name': 'Incompleto', 'route': 'DIRECT', 'environment': 'HOMOLOGATION'})
        result = self.cmd('fiscal_readiness_assess', {'profileId': profile['id']})
        self.assertEqual(result['status'], 'PENDING_DATA')
        fields = {x['field'] for x in result['missing']}
        self.assertTrue({'issuerRef', 'ufs', 'documents', 'scenarioApprovalRef', 'certificateRef', 'registrationRef'} <= fields)
        self.assertFalse(result['productionReady']); self.assertFalse(result['realOperationAllowed'])
        with self.assertRaisesRegex(Error, 'FISCAL_PROFILE_INCOMPLETE'):
            self.cmd('fiscal_local_preflight', {'profileId': profile['id'], 'document': 'CTE', 'operation': 'ISSUE', 'businessReference': 'shipment-test', 'requestReference': 'preflight-test'})

    def test_local_preflight_query_cancel_and_close_are_explicitly_demo(self):
        profile = self.cmd('fiscal_profile_create', self.profile())
        assessment = self.cmd('fiscal_readiness_assess', {'profileId': profile['id']})
        self.assertEqual(assessment['status'], 'LOCAL_CONTRACT_READY')
        self.assertTrue(assessment['readyForLocalTest']); self.assertEqual(assessment['externalGates'], [])
        for document, operation in [('CTE', 'ISSUE'), ('CTE', 'QUERY'), ('CTE', 'CANCEL'), ('MDFE', 'CLOSE'), ('CIOT', 'CLOSE'), ('NFE_REFERENCE', 'QUERY')]:
            result = self.cmd('fiscal_local_preflight', {'profileId': profile['id'], 'document': document, 'operation': operation, 'businessReference': 'shipment-test', 'requestReference': document + '-' + operation})
            self.assertEqual(result['status'], 'DEMO_PREPARED')
            self.assertFalse(result['result']['officialDocument']); self.assertFalse(result['result']['real'])
            self.assertIn('NOT_OFFICIAL_XML', result['envelope']['format'])
        with self.engine.db() as db:
            self.assertEqual(len(self.engine.all(db, 'outbox')), 0)
            self.assertEqual(len(self.engine.all(db, 'fiscalDocument')), 0)

    def test_direct_and_provider_never_enable_transmission_or_production(self):
        for route in ['DIRECT', 'PROVIDER']:
            profile = self.cmd('fiscal_profile_create', self.profile(route, 'PRODUCTION'))
            assessment = self.cmd('fiscal_readiness_assess', {'profileId': profile['id']})
            self.assertTrue(assessment['readyForLocalTest']); self.assertFalse(assessment['externalHomologationAccepted'])
            codes = {x['code'] for x in assessment['externalGates']}
            self.assertTrue({'LIVE_ADAPTER_NOT_IMPLEMENTED', 'HOMOLOGATION_PENDING', 'PRODUCTION_RELEASE_PENDING'} <= codes)
            result = self.cmd('fiscal_local_preflight', {'profileId': profile['id'], 'document': 'CTE', 'operation': 'ISSUE', 'businessReference': 'shipment-test', 'requestReference': 'prepared-only'})
            self.assertEqual(result['status'], 'PREPARED_EXTERNAL_BLOCKED')
            self.assertFalse(result['liveTransmissionEnabled']); self.assertFalse(result['productionReady'])
            with self.assertRaisesRegex(Error, 'FISCAL_EXTERNAL_TRANSMISSION_NOT_IMPLEMENTED'):
                FiscalAdapterPort().submit(result['envelope'])

    def test_revision_is_immutable_old_assessment_survives_reopen(self):
        values = self.profile(); original = self.cmd('fiscal_profile_create', values)
        before = self.cmd('fiscal_readiness_assess', {'profileId': original['id']})
        values['ufs'] = ['RJ']; values['name'] = 'Nova versão'
        successor = self.cmd('fiscal_profile_revise', {'id': original['id'], 'version': 1, 'values': values, 'reason': 'Novo cenário sintético'})
        self.assertEqual(successor['profileRevision'], 2); self.assertEqual(successor['supersedes'], original['id'])
        self.assertEqual(self.engine.state(self.user, original['id']), original)
        reopened = FiscalEngine(self.path, self.now)
        self.assertEqual(reopened.state(self.user, before['id'])['profileSnapshot']['ufs'], ['SP'])
        self.assertEqual(reopened.state(self.user, successor['id'])['ufs'], ['RJ'])
        with self.assertRaisesRegex(Error, 'FISCAL_REVISION_EXISTS'):
            self.cmd('fiscal_profile_revise', {'id': original['id'], 'version': 1, 'values': values, 'reason': 'Não bifurcar política'})

    def test_idempotency_and_metadata_validation(self):
        values = self.profile(); profile = self.cmd('fiscal_profile_create', values, 'create-once')
        self.assertEqual(self.cmd('fiscal_profile_create', values, 'create-once')['id'], profile['id'])
        request = {'profileId': profile['id'], 'document': 'CTE', 'operation': 'ISSUE', 'businessReference': 'shipment-test', 'requestReference': 'request-once'}
        result = self.cmd('fiscal_local_preflight', request, 'preflight-once')
        self.assertEqual(self.cmd('fiscal_local_preflight', request, 'preflight-once')['id'], result['id'])
        for change, code in [({'ufs': ['XX']}, 'FISCAL_UFS'), ({'ufs': [{}]}, 'FISCAL_UFS'), ({'documents': ['CTE', 'CTE']}, 'FISCAL_DOCUMENTS'), ({'route': 'DIRECT'}, 'FISCAL_ROUTE_ENVIRONMENT'), ({'certificateRef': 'not-a-reference'}, 'FISCAL_METADATA_REFERENCE'), ({'schemaRefs': {'UNKNOWN': 'schema:test'}}, 'FISCAL_SCHEMA_REFS')]:
            with self.assertRaisesRegex(Error, code):
                self.cmd('fiscal_profile_create', {**values, **change})
        with self.assertRaisesRegex(Error, 'NFE_IS_EXTERNAL_REFERENCE'):
            self.cmd('fiscal_local_preflight', {**request, 'document': 'NFE_REFERENCE'})
        with self.assertRaisesRegex(Error, 'FISCAL_CLOSE_NOT_APPLICABLE'):
            self.cmd('fiscal_local_preflight', {**request, 'operation': 'CLOSE'})

    def test_malformed_field_types_are_domain_errors_without_partial_preflight(self):
        values = self.profile()
        for field, expected in [('route', 'FISCAL_ROUTE'), ('environment', 'FISCAL_ENVIRONMENT')]:
            for malformed in [[], {}, None, False, 123]:
                with self.subTest(field=field, value=malformed):
                    with self.assertRaisesRegex(Error, expected):
                        self.cmd('fiscal_profile_create', {**values, field: malformed})
        profile = self.cmd('fiscal_profile_create', values)
        request = {'profileId': profile['id'], 'document': 'CTE', 'operation': 'ISSUE',
                   'businessReference': 'shipment-test', 'requestReference': 'malformed-test'}
        for field, expected in [('operation', 'FISCAL_OPERATION'), ('document', 'FISCAL_DOCUMENT_NOT_CONFIGURED')]:
            for malformed in [[], {}, None, False, 123]:
                with self.subTest(field=field, value=malformed):
                    with self.assertRaisesRegex(Error, expected):
                        self.cmd('fiscal_local_preflight', {**request, field: malformed})
        with self.engine.db() as db:
            self.assertEqual(len(self.engine.all(db, 'fiscalPreflight')), 0)
        self.assertEqual(self.cmd('fiscal_local_preflight', request)['status'], 'DEMO_PREPARED')


if __name__ == '__main__':
    unittest.main()
